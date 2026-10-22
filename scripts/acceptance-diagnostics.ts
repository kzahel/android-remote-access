// Public CI may report code locations, never raw fixture output, QR data or grants.
export function nativeFailure(message: string, output: string): Error {
  const frames = output.match(
    /^\s*at dev\.remoteaccess\.[A-Za-z0-9_.$]+\([A-Za-z0-9_.-]+:\d+\)\s*$/gm,
  );
  return new Error(
    `${message}\n${
      frames
        ?.slice(0, 8)
        .map((line) => line.trim())
        .join("\n") ??
      "No application stack locations; private fixture log retained"
    }`,
  );
}
