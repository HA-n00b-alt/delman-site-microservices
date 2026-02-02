import swaggerJsdoc from 'swagger-jsdoc';
import { SUPPORTED_IMAGE_FORMATS, SUPPORTED_AUDIO_FORMATS, VALID_FIT_OPTIONS, DEBUG_LEVELS } from '../types';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Media Processing Microservice API',
      version: '1.0.0',
      description: 'A microservice for image conversion and audio waveform extraction',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current server',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
          description: 'API key for authentication',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
            details: {
              type: 'string',
              description: 'Additional error details',
            },
          },
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'degraded'],
            },
            checks: {
              type: 'object',
              properties: {
                audiowaveform: { type: 'boolean' },
                sharp: { type: 'boolean' },
              },
            },
            uptime: {
              type: 'number',
              description: 'Uptime in seconds',
            },
          },
        },
        AudioPeaksResponse: {
          type: 'object',
          properties: {
            peaks: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of peak values normalized to 0-1',
            },
            samples: {
              type: 'integer',
              description: 'Number of samples returned',
            },
          },
        },
      },
    },
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Image', description: 'Image conversion endpoints' },
      { name: 'Audio', description: 'Audio processing endpoints' },
    ],
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
