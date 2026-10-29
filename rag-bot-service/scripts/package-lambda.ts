import fs from 'fs';
import path from 'path';
import esbuild from 'esbuild';
import archiver from 'archiver';

interface LambdaPackageTarget {
  name: string;
  entryPoint: string;
  cjsOut: string;
  distZip: string;
  rootZip: string;
  external?: string[];
}

async function bundleTarget(target: LambdaPackageTarget, distDir: string) {
  console.log(`\n========================================================`);
  console.log(`[Lambda Packager] Building "${target.name}" from ${target.entryPoint}`);
  console.log(`========================================================`);

  const outfile = path.join(distDir, target.cjsOut);

  await esbuild.build({
    entryPoints: [target.entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    sourcemap: true,
    minify: true,
    external: [
      'pg-native',
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-validator',
      'class-transformer',
      ...(target.external || []),
    ],
  });

  const bundleBuffer = fs.readFileSync(outfile);
  const zipPath = path.join(distDir, target.distZip);
  const rootZipPath = path.resolve(process.cwd(), '..', target.rootZip);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      const sizeMb = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`[Lambda Packager] Created package: ${zipPath} (${sizeMb} MB)`);
      resolve();
    });

    output.on('error', err => reject(err));
    archive.on('error', err => reject(err));

    archive.pipe(output);

    // Provide entry points as index.js, lambda.js, and <target.name>.js for flexible handlers
    archive.append(bundleBuffer, { name: 'index.js' });
    archive.append(bundleBuffer, { name: 'lambda.js' });
    archive.append(bundleBuffer, { name: `${target.name}.js` });

    // Include .env file for default configuration
    const envFile = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envFile)) {
      const envBuffer = fs.readFileSync(envFile);
      archive.append(envBuffer, { name: '.env' });
    }

    // Include database migration SQL files
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const sqlFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
      for (const sqlFile of sqlFiles) {
        const fullPath = path.join(migrationsDir, sqlFile);
        const migrationBuffer = fs.readFileSync(fullPath);
        archive.append(migrationBuffer, { name: `migrations/${sqlFile}` });
      }
    }

    archive.finalize();
  });

  // Copy zip to monorepo root directory for convenient direct upload
  fs.copyFileSync(zipPath, rootZipPath);
  console.log(`[Lambda Packager] Copied package to root: ${rootZipPath}`);
}

async function packageAll() {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const targets: LambdaPackageTarget[] = [
    {
      name: 'download-lambda',
      entryPoint: path.resolve(process.cwd(), 'src', 'download-lambda.ts'),
      cjsOut: 'download-lambda.cjs',
      distZip: 'download-lambda.zip',
      rootZip: 'download-lambda.zip',
    },
    {
      name: 'ingestion-lambda',
      entryPoint: path.resolve(process.cwd(), 'src', 'ingestion-lambda.ts'),
      cjsOut: 'ingestion-lambda.cjs',
      distZip: 'ingestion-lambda.zip',
      rootZip: 'ingestion-lambda.zip',
    },
    {
      name: 'api-lambda',
      entryPoint: path.resolve(process.cwd(), 'src', 'lambda.ts'),
      cjsOut: 'lambda.cjs',
      distZip: 'lambda-bundle.zip',
      rootZip: 'api-lambda.zip',
    },
  ];

  // Check if a specific target argument was passed (e.g. "tsx scripts/package-lambda.ts download")
  const filterArg = process.argv[2]?.toLowerCase();
  const selectedTargets = filterArg
    ? targets.filter(t => t.name.includes(filterArg))
    : targets;

  for (const target of selectedTargets) {
    await bundleTarget(target, distDir);
  }

  console.log('\n[Lambda Packager] All packaging targets completed successfully.');
}

packageAll()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[Lambda Packager] Packaging failed:', err);
    process.exit(1);
  });
