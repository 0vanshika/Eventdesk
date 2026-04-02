function parseIntegerFlag(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected ${name} to be a positive integer.`);
  }
  return parsed;
}

export function printUsage() {
  console.log(`Usage:
  node src/index.js --source=unstop [--max-urls=50] [--since-hours=24] [--dry-run] [--verbose]
`);
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    source: 'unstop',
    maxUrls: 50,
    sinceHours: null,
    dryRun: false,
    verbose: false,
    help: false
  };

  argv.forEach((arg) => {
    if (arg === '--dry-run') {
      options.dryRun = true;
      return;
    }

    if (arg === '--verbose') {
      options.verbose = true;
      return;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return;
    }

    if (arg.startsWith('--source=')) {
      options.source = arg.split('=')[1]?.trim() || '';
      return;
    }

    if (arg.startsWith('--max-urls=')) {
      options.maxUrls = parseIntegerFlag(arg.split('=')[1], '--max-urls');
      return;
    }

    if (arg.startsWith('--since-hours=')) {
      options.sinceHours = parseIntegerFlag(arg.split('=')[1], '--since-hours');
      return;
    }

    throw new Error(`Unknown flag: ${arg}`);
  });

  if (options.source !== 'unstop') {
    throw new Error(`Unsupported source: ${options.source}`);
  }

  return options;
}
