export default {
  apps: [
    {
      name: 'star-cement-djp-api',
      script: './src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 10000,
      node_args: '--max-old-space-size=4096',

      // Default / Development Environment
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },

      // Production Environment (`pm2 start ecosystem.config.js --env production`)
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        BASE_PATH: ''
      },

      // Logging configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true
    }
  ]
};
