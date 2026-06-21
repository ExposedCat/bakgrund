export async function busctl(args: string[]): Promise<string> {
  const command = new Deno.Command("busctl", {
    args: ["--user", "--no-pager", ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();

  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }

  return new TextDecoder().decode(result.stdout).trim();
}

export async function busctlJson(args: string[]) {
  return JSON.parse(await busctl(["--json=short", ...args]));
}
