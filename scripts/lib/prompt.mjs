import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function confirm(message, defaultYes = false) {
  if (!input.isTTY) {
    console.log(`${message} [skipped: non-interactive terminal]`);
    return false;
  }

  const hint = defaultYes ? 'Y/n' : 'y/N';
  const rl = readline.createInterface({ input, output });

  try {
    const answer = (await rl.question(`${message} (${hint}) `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
