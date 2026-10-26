import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private store = new Map<string, RateLimitRecord>();
  private readonly maxRequests = env.RATE_LIMIT_MAX;
  private readonly windowMs = env.RATE_LIMIT_WINDOW_MS;

  use(req: Request, res: Response, next: NextFunction) {
    if (
      process.env.NODE_ENV === 'test' ||
      req.path === '/health' ||
      req.path.startsWith('/documentation')
    ) {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const isLoopback =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip === 'localhost';

    // Exempt localhost in development mode to avoid locking out local dev frontends
    if (env.NODE_ENV === 'development' && isLoopback) {
      return next();
    }

    // Always exempt essential auth onboarding endpoints so login/signup are never blocked by background polling
    if (
      req.path.startsWith('/v1/auth/login') ||
      req.path.startsWith('/v1/auth/register') ||
      req.path.startsWith('/v1/auth/demo-profiles')
    ) {
      return next();
    }

    const now = Date.now();
    const record = this.store.get(ip);

    if (!record || now > record.resetAt) {
      this.store.set(ip, { count: 1, resetAt: now + this.windowMs });
      return next();
    }

    record.count++;
    if (record.count > this.maxRequests) {
      res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please slow down.',
        },
      });
    }

    next();
  }
}
