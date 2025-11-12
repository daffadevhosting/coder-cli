import chalk from 'chalk';

export function displayBanner(): void {
  const banner = `
│ >    1 __     ___  _____  ____  ____  ____ 
│      2 \ \   / __)(  _  )(  _ \( ___)(  _ \
│      3  ) ) ( (__  )(_)(  )(_) ))__)  )   / 
│      4 /_/   \___)(_____)(____/(____)(_)\_) 
`;

  console.log(chalk.cyan(banner));
}