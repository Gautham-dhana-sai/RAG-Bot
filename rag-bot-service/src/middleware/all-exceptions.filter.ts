import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppError) {
      return response.status(exception.statusCode).json({
        success: false,
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : (res as any).message || exception.message;
      const details = typeof res === 'object' ? (res as any).details : undefined;

      return response.status(status).json({
        success: false,
        error: {
          code: status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
          message: Array.isArray(message) ? message.join(', ') : message,
          details,
        },
      });
    }

    logger.error('Unhandled internal server error:', exception);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An internal error occurred. Please try again later.',
      },
    });
  }
}

