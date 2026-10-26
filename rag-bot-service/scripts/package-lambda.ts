import fs from 'fs';
import path from 'path';
import esbuild from 'esbuild';
import archiver from 'archiver';

async function packageLambda() {
  console.log('[Lambda Packager] Compiling Lambda bundle with esbuild...');

  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outfile = path.join(distDir, 'lambda.cjs');

  // Bundle into a single standalone CommonJS file for AWS Lambda Node.js runtime
  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), 'src', 'lambda.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    sourcemap: true,
    minify: true,
    external: [
      // Optional native and framework bindings
      'pg-native',
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-validator',
      'class-transformer',
    ],
  });

  console.log(`[Lambda Packager] Successfully bundled lambda entry point to ${outfile}`);

  const zipPath = path.join(distDir, 'lambda-bundle.zip');
  const rootZipPath = path.resolve(process.cwd(), '..', 'ingestion-lambda.zip');

  // Read bundled content into memory buffer to avoid concurrent file stream locks
  const bundleBuffer = fs.readFileSync(outfile);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    // Standard compression level 6 ensures compatibility with all zip extractors (Windows, Mac, Linux, AWS Lambda)
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      const sizeMb = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`[Lambda Packager] Created deployment package: ${zipPath} (${sizeMb} MB)`);
      resolve();
    });

    output.on('error', err => reject(err));
    archive.on('error', err => reject(err));

    archive.pipe(output);

    // Provide entry points as both index.js and lambda.js for flexible Lambda handler configuration
    archive.append(bundleBuffer, { name: 'index.js' });
    archive.append(bundleBuffer, { name: 'lambda.js' });

    // Include .env file so Lambda automatically loads environment configuration
    const envFile = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envFile)) {
      const envBuffer = fs.readFileSync(envFile);
      archive.append(envBuffer, { name: '.env' });
    }

    // Include migration files for Lambda RDS initialization
    const migrationFile = path.resolve(process.cwd(), 'migrations', '001_init.sql');
    if (fs.existsSync(migrationFile)) {
      const migrationBuffer = fs.readFileSync(migrationFile);
      archive.append(migrationBuffer, { name: 'migrations/001_init.sql' });
    }

    archive.finalize();
  });

  // Copy finalized zip to project root ingestion-lambda.zip
  fs.copyFileSync(zipPath, rootZipPath);
  console.log(`[Lambda Packager] Copied deployment package to root: ${rootZipPath}`);
}

packageLambda()
  .then(() => {
    console.log('[Lambda Packager] Packaging finished successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Lambda Packager] Packaging failed:', err);
    process.exit(1);
  });
