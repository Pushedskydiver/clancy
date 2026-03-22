/**
 * Role-based file filtering for the installer.
 *
 * Copies command/workflow files from role directories into a flat destination,
 * applying core vs optional role filtering. Disabled optional roles have their
 * previously-installed files removed.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { copyDir } from '~/installer/file-ops/file-ops.js';

/** Roles that are always installed regardless of CLANCY_ROLES. */
const CORE_ROLES = new Set(['implementer', 'reviewer', 'setup']);

/**
 * Copy files from role subdirectories into a flat destination directory.
 *
 * Walks `src/roles/{role}/{subdir}/` for each role and copies all files
 * flat into `dest`. Core roles (implementer, reviewer, setup) are always
 * copied. Optional roles (planner, etc.) are only copied if listed in
 * the CLANCY_ROLES env var, or if no .clancy/.env exists yet (first install).
 *
 * @param rolesDir - The roles source directory (`src/roles/`).
 * @param subdir - The subdirectory within each role (`commands` or `workflows`).
 * @param dest - The flat destination directory.
 * @param enabledRoles - Set of enabled optional roles, or null to install all (first install).
 */
export function copyRoleFiles(
  rolesDir: string,
  subdir: string,
  dest: string,
  enabledRoles: Set<string> | null,
): void {
  mkdirSync(dest, { recursive: true });

  const roles = readdirSync(rolesDir, { withFileTypes: true }).filter((d) =>
    d.isDirectory(),
  );

  for (const role of roles) {
    const srcDir = join(rolesDir, role.name, subdir);
    if (!existsSync(srcDir)) continue;

    // Core roles always install; optional roles need explicit opt-in
    if (!CORE_ROLES.has(role.name) && enabledRoles !== null) {
      if (!enabledRoles.has(role.name)) {
        // Remove previously-installed files for disabled optional roles
        for (const file of readdirSync(srcDir)) {
          const target = join(dest, file);
          if (existsSync(target)) unlinkSync(target);
        }
        continue;
      }
    }

    copyDir(srcDir, dest);
  }
}
