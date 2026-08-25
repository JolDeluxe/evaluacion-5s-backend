module.exports = {
  apps: [
    {
      name: 'encuestas-5s-backend',
      script: 'src/index.ts',
      interpreter: 'bun',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
