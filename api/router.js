// Single serverless function that serves every /api/* route (see vercel.json).
const { handle } = require('../server/app');

module.exports = handle;
