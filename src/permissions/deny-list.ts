// The built-in deny list (PERM-4): paths that are never read or written, in any mode.
// This is the one place the PERM-4 categories become concrete paths. Config can add
// to it (`permissions.extraDeniedPaths`) but never remove from it.

/** Folders and files under the home folder, written with a leading `~/`. */
const homeDeniedPaths = [
  // SSH, GPG, and cloud or tool credentials.
  "~/.ssh",
  "~/.gnupg",
  "~/.aws",
  "~/.azure",
  "~/.config/gcloud",
  "~/.kube",
  "~/.docker/config.json",
  "~/.config/gh",
  "~/.netrc",
  "~/.npmrc",
  "~/.pypirc",
  "~/.git-credentials",
  "~/.pgpass",
  "~/.password-store",
  // Keychains.
  "~/Library/Keychains",
  // Browser profiles: cookies, saved passwords, history.
  "~/Library/Application Support/Google/Chrome",
  "~/Library/Application Support/Chromium",
  "~/Library/Application Support/BraveSoftware",
  "~/Library/Application Support/Microsoft Edge",
  "~/Library/Application Support/Arc",
  "~/Library/Application Support/Firefox",
  "~/Library/Safari",
  "~/Library/Containers/com.apple.Safari",
  "~/Library/Cookies",
  // Password managers.
  "~/Library/Application Support/1Password",
  "~/Library/Group Containers/2BUA8C4S2C.com.1password",
];

/** System directories. `/etc` resolves to `/private/etc`; both forms are listed. */
const systemDeniedPaths = [
  "/System",
  "/Library/Keychains",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/usr/lib",
  "/usr/libexec",
  "/etc",
  "/private/etc",
  "/private/var/db",
];

/**
 * Private key and credential file names, denied wherever they are, since they are
 * often copied into project folders that are inside an allowed root.
 */
export const deniedFileNames: readonly string[] = [
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".netrc",
  ".pgpass",
  ".git-credentials",
];

/**
 * The default deny list, unresolved: `~` is still a prefix. The vix root is added
 * by the path policy, because transcripts and the config must not be readable or
 * writable by the model (a model that could write config.json could change its mode).
 */
export function defaultDeniedPaths(): string[] {
  return [...homeDeniedPaths, ...systemDeniedPaths];
}
