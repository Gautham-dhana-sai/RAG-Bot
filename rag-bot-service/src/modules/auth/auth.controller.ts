import { Controller, Post, Get, Body, Req, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { BadRequestError } from '../../shared/errors.js';

@ApiTags('Authentication & Onboarding')
@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user, workspace (tenant), and portal (entity)' })
  async register(@Body() body: any) {
    const schema = z.object({
      name: z.string().optional(),
      username: z.string().min(2, 'Username must be at least 2 characters').optional(),
      email: z.string().optional(),
      identifier: z.string().optional(),
      password: z.string().min(6, 'Password must be at least 6 characters').optional(),
      workspaceName: z.string().optional(),
      portalName: z.string().optional(),
      portfolioName: z.string().optional(),
    }).refine(data => !!(data.username || data.email || data.identifier), {
      message: 'Username or email is required',
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid registration data', parsed.error.format());
    }

    return this.authService.register(parsed.data);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in by username or email' })
  async login(@Body() body: any) {
    const schema = z.object({
      identifier: z.string().optional(),
      username: z.string().optional(),
      email: z.string().optional(),
      password: z.string().optional(),
    }).refine(data => !!(data.identifier || data.username || data.email), {
      message: 'Username or email is required to sign in',
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid login data', parsed.error.format());
    }

    return this.authService.login(parsed.data);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out and invalidate session' })
  async logout(@Req() req: Request) {
    const authHeader = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      this.authService.logout(token);
    }
    return { success: true };
  }

  @Get('demo-profiles')
  @ApiOperation({ summary: 'Get ready-to-use demo profiles for 1-click workspace switching' })
  async getDemoProfiles() {
    return this.authService.getDemoProfiles();
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user session and available workspaces' })
  async getMe(@Req() req: Request) {
    return this.authService.getCurrentSession(req.authContext!);
  }
}

