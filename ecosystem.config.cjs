module.exports = {
  apps: [
    {
      name: 'encuestas-5s-backend',
      // Apunta a la ruta real y válida de Bun en tu equipo actual:
      script: 'C:\\Users\\CUADRA\\AppData\\Roaming\\npm\\node_modules\\bun\\bin\\bun.exe',
      // Argumentos para que Bun ejecute directamente el punto de entrada TypeScript
      args: 'run src/index.ts',
      // Indicamos a PM2 que no use intérprete externo ya que script es el ejecutable de Bun
      interpreter: 'none',
      exec_mode: 'fork',
      shutdown_with_message: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Mexico_City',
      },
      env_production: {
        NODE_ENV: 'production',
        TZ: 'America/Mexico_City',
      },
      // Gestión de resiliencia y recuperación automática
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 8000,
      // Registro y rotación de logs del sistema
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};