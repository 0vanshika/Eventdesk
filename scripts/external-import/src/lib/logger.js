function write(level, args) {
  const prefix = `[external-import:${level}]`;
  console[level === 'debug' ? 'log' : level](prefix, ...args);
}

export function createLogger({ verbose = false } = {}) {
  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    debug: (...args) => {
      if (verbose) {
        write('debug', args);
      }
    }
  };
}
