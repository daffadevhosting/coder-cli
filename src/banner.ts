import chalk from 'chalk';

export function displayBanner(): void {
  const banner = `
__     ___  _____  ____  ____  ____ 
\\ \\   / __)(  _  )(  _ \\( ___)(  _ \\
 ) )  ( (__  )(_)(  )(_) ))__)  )   /
/_/   \\___)(_____)(____/(____)(_)\\_)
`;

  console.log(chalk.cyan(banner));
}