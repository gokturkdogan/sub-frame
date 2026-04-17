/** İnsanların okuyacağı tek satırlık komut özeti (shell ile birebir aynı olmak zorunda değil). */
export function formatShellCommand(cmd: string, args: string[]): string {
  const esc = (a: string) =>
    /[\s"'\\]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a;
  return `${cmd} ${args.map(esc).join(" ")}`;
}
