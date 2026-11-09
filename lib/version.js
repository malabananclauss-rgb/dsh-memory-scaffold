// Version constants for the qing-self package (formerly dsh-self / dsh-memory-scaffold).
// CLI binary and on-disk format identity remain `dsh-self` for compatibility.
//
// FORMAT_VERSION is the *locked* data format. Bump only with a migration path.
// TEMPLATE_VERSION tracks the shipped scaffold templates (CHANGELOG.md).
// TOOL_VERSION tracks this package's own code.

export const TOOL_NAME = 'dsh-self';
export const TOOL_VERSION = '0.4.0';
export const FORMAT_VERSION = 1;
export const TEMPLATE_VERSION = '1.0.0';
