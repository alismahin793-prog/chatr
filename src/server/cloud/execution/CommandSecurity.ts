import { ForbiddenError, ValidationError } from "../../errors";

/**
 * Command security for the Cloud Development environment.
 *
 * The execution layer NEVER runs a shell. It launches an allowlisted program
 * with an explicit argument vector (spawn without a shell), so user input can
 * never reach a shell interpreter. This module is defense in depth: it also
 * validates the argument vector and rejects shell metacharacters, path
 * escapes, and destructive/force flags before the spawn even happens.
 */

/** Programs the terminal may launch directly (Windows .cmd names accepted). */
export const ALLOWED_PROGRAMS = new Set([
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
  "pnpm",
  "pnpm.cmd",
  "yarn",
  "yarn.cmd",
  "node",
  "node.exe",
  "git",
  "git.exe",
  "tsx",
  "tsx.exe",
  "eslint",
  "vitest",
  "next",
]);

/** Shell metacharacters that would only matter to a shell — always rejected. */
const SHELL_METACHARACTERS = /[\r\n;|&<>`$"\\']/;

/**
 * Flags we never pass through even if a program would accept them. They are
 * the "force" escape hatches (force push, hard reset, clean, bypass scripts)
 * that can destroy data or smuggle arbitrary code into a build.
 */
const FORBIDDEN_ARG_TOKENS = new Set([
  "--force",
  "-f",
  "--hard",
  "--clean",
  "-d",
  "-D",
  "--delete",
  "--unsafe-perm",
  "--ignore-scripts",
  "--allow-unsafe-inline-content",
]);

/** Git subcommands that can rewrite/destroy history or remote state. */
const FORBIDDEN_GIT_SUBCOMMANDS = new Set([
  "reset",
  "clean",
  "rebase",
  "filter-branch",
  "fsck",
  "gc",
  "prune",
  "rm",
  "remote",
  "replace",
  "update-ref",
  "merge",
  "cherry-pick",
  "checkout-index",
  "submodule",
  "worktree",
  "archive",
]);

/** Script names we will not run through `npm run` / `yarn` (policy). */
const FORBIDDEN_SCRIPT_NAMES = new Set([
  "preinstall",
  "postinstall",
  "prepare",
  "prepublish",
]);

/**
 * Tokenizes a command line into an argv, honoring single/double quotes and
 * backslash escapes so messages like "fix: thing" survive intact. This is the
 * ONLY place quotes are understood; the executed argv is passed straight to
 * spawn with shell:false.
 */
export function parseCommandLine(line: string): string[] {
  if (typeof line !== "string") throw new ValidationError("Command must be a string.");
  if (line.length > 2000) throw new ValidationError("Command is too long.");
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let inToken = false;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      inToken = true;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      inToken = true;
      continue;
    }
    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char;
        inToken = true;
        continue;
      }
      if (/\s/.test(char)) {
        if (inToken) {
          tokens.push(current);
          current = "";
          inToken = false;
        }
        continue;
      }
      current += char;
      inToken = true;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    current += char;
    inToken = true;
  }
  if (escaped) current += "\\";
  if (quote !== null) throw new ValidationError("Unterminated quote in command.");
  if (inToken || current.length > 0) tokens.push(current);
  return tokens;
}

function rejectUnsafeToken(token: string): void {
  if (token.length === 0) throw new ValidationError("Empty command argument.");
  if (token.length > 400) throw new ValidationError("Command argument is too long.");
  if (token.startsWith("-") && FORBIDDEN_ARG_TOKENS.has(token.toLowerCase())) {
    throw new ForbiddenError(`Flag "${token}" is not allowed.`);
  }
  if (SHELL_METACHARACTERS.test(token)) {
    throw new ForbiddenError("Shell metacharacters are not allowed in commands.");
  }
}

/** Normalizes a program name to the OS executable form (Windows .cmd). */
const WIN_CMD_PROGRAMS = new Set(["npm", "npx", "pnpm", "yarn", "tsx", "eslint", "vitest", "next"]);
export function resolveProgramName(program: string): string {
  if (process.platform === "win32" && WIN_CMD_PROGRAMS.has(program)) {
    return `${program}.cmd`;
  }
  return program;
}

/**
 * Validates a parsed command (program + args) and returns the normalized
 * program name + argument vector for spawn. `runFrom` expects the workspace
 * root; every check here is pure and unit-testable.
 */
export function assertSafeCommand(
  program: string,
  args: string[]
): { program: string; args: string[] } {
  if (typeof program !== "string" || program.length === 0) {
    throw new ForbiddenError("No program specified.");
  }
  if (program.length > 120) throw new ValidationError("Program name is too long.");

  const baseName = program.split(/[\\/]/).pop() ?? program;
  if (!ALLOWED_PROGRAMS.has(baseName)) {
    throw new ForbiddenError(`Program "${baseName}" is not allowed.`);
  }
  if (baseName.toLowerCase().startsWith("sh") || /(bash|cmd|powershell|pwsh|fish|zsh)/i.test(baseName)) {
    throw new ForbiddenError(`Shell "${baseName}" is not allowed.`);
  }

  if (!Array.isArray(args) || args.length > 128) {
    throw new ValidationError("Invalid command arguments.");
  }

  const normalizedArgs: string[] = [];
  for (const raw of args as string[]) {
    if (typeof raw !== "string") throw new ValidationError("Invalid command argument.");
    rejectUnsafeToken(raw);
    normalizedArgs.push(raw);
  }

  // Program-specific safety.
  const lower = baseName.toLowerCase();
  if (lower.startsWith("git")) {
    rejectGitCommand(normalizedArgs);
  }
  if (normalizedArgs.length >= 2 && normalizedArgs[0] === "run" && normalizedArgs[1].startsWith("-")) {
    throw new ForbiddenError("Invalid npm script.");
  }
  if (
    (lower.startsWith("npm") || lower.startsWith("yarn")) &&
    normalizedArgs[0] === "run" &&
    normalizedArgs[1] &&
    FORBIDDEN_SCRIPT_NAMES.has(normalizedArgs[1].toLowerCase())
  ) {
    throw new ForbiddenError(`Script "${normalizedArgs[1]}" is not allowed.`);
  }

  return { program: resolveProgramName(baseName), args: normalizedArgs };
}

function rejectGitCommand(args: string[]): void {
  const subcommand = args[0];
  if (!subcommand || subcommand.startsWith("-") || subcommand === "help") {
    throw new ForbiddenError("Specify a git subcommand.");
  }
  if (FORBIDDEN_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new ForbiddenError(`"git ${subcommand}" is not allowed in the Cloud terminal.`);
  }
  // `git push` may never force.
  if (subcommand === "push") {
    for (const a of args) {
      if (a === "--force" || a === "-f" || a.startsWith("--force-with-lease")) {
        throw new ForbiddenError("Force pushes are not allowed.");
      }
    }
  }
  // `git switch`/`checkout` may never dump a stash / reset disguised refs.
  if (subcommand === "checkout" || subcommand === "switch") {
    for (const a of args) {
      if (a.startsWith("-") && !a.startsWith("--branch") && !a.startsWith("-b")) {
        if (a !== "-C") {
          throw new ForbiddenError(`"git ${subcommand} ${a}" is not supported.`);
        }
      }
    }
  }
}

export type CommandResult = { program: string; args: string[] };

/** Full validation for a raw terminal input line (no quotes → must already parse). */
export function assertSafeLine(line: string): CommandResult {
  const tokens = parseCommandLine(line);
  if (tokens.length === 0) throw new ValidationError("Command cannot be empty.");
  const [program, ...args] = tokens;
  return assertSafeCommand(program, args);
}