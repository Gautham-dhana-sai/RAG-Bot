import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../modules/auth/auth.service.js';
import { AuthContext } from '../types/index.js';

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      req.authContext = await this.authService.resolveAuthContext(req.headers as any);
      next();
    } catch (err) {
      next(err);
    }
  }
}
