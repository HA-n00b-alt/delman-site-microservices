// Test setup file (loaded before tests; env must be set before app is imported)
process.env.NODE_ENV = 'test';
process.env.SERVICE_API_KEY = 'test-api-key';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000,http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
