
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const SHELL: string;
	export const npm_command: string;
	export const BETTER_AUTH_SECRET: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const allowSubstitutes: string;
	export const USER_ZDOTDIR: string;
	export const GC_LARGE_ALLOC_WARN_INTERVAL: string;
	export const __ETC_PROFILE_DONE: string;
	export const COLORTERM: string;
	export const __HM_SESS_VARS_SOURCED: string;
	export const HYPRLAND_CMD: string;
	export const XDG_CONFIG_DIRS: string;
	export const CLAUDE_CODE_CHILD_SESSION: string;
	export const hardeningDisable: string;
	export const NIX_LD_LIBRARY_PATH: string;
	export const TERM_PROGRAM_VERSION: string;
	export const DATABASE_URL: string;
	export const configureFlags: string;
	export const XDG_BACKEND: string;
	export const mesonFlags: string;
	export const PKG_CONFIG_PATH: string;
	export const AI_AGENT: string;
	export const DIRENV_ACTIVE: string;
	export const DEVENV_TASK_FILE: string;
	export const CLAUDE_CODE_SESSION_ID: string;
	export const PGPORT: string;
	export const DEVENV_CMDLINE: string;
	export const DEVENV_DIRENVRC_VERSION: string;
	export const SYSTEMD_XKB_DIRECTORY: string;
	export const CLAUDE_PID: string;
	export const DIRENV_DIR: string;
	export const XDG_DATA_HOME: string;
	export const npm_config_verify_deps_before_run: string;
	export const STRINGS: string;
	export const CLAUDE_EFFORT: string;
	export const XCURSOR_PATH: string;
	export const OPENAI_API_KEY: string;
	export const LOCALE_ARCHIVE_2_27: string;
	export const LIBVA_DRIVER_NAME: string;
	export const HL_INITIAL_WORKSPACE_TOKEN: string;
	export const NO_AT_BRIDGE: string;
	export const BRIGHTDATA_API_TOKEN_FILE: string;
	export const BETTER_AUTH_URL: string;
	export const DIRENV_FILE: string;
	export const EDITOR: string;
	export const XDG_SEAT: string;
	export const PWD: string;
	export const NIX_PROFILES: string;
	export const SOURCE_DATE_EPOCH: string;
	export const LOGNAME: string;
	export const XDG_SESSION_TYPE: string;
	export const NIX_ENFORCE_NO_NATIVE: string;
	export const CUPS_DATADIR: string;
	export const MANPATH: string;
	export const NIX_PATH: string;
	export const CLAUDE_CODE_MESSAGING_SOCKET: string;
	export const NIXPKGS_CONFIG: string;
	export const CXX: string;
	export const system: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const FZF_DEFAULT_COMMAND: string;
	export const VSCODE_GIT_ASKPASS_NODE: string;
	export const DEVENV_DOTFILE: string;
	export const CLAUDECODE: string;
	export const VSCODE_INJECTION: string;
	export const DEVENV_DIRENVRC_ROLLING_UPGRADE: string;
	export const GTK2_RC_FILES: string;
	export const IN_NIX_SHELL: string;
	export const HOME: string;
	export const NIX_BINTOOLS: string;
	export const SSH_ASKPASS: string;
	export const LANG: string;
	export const NIXOS_OZONE_WL: string;
	export const LS_COLORS: string;
	export const _JAVA_AWT_WM_NONREPARENTING: string;
	export const XDG_CURRENT_DESKTOP: string;
	export const NH_FLAKE: string;
	export const CLAUDE_CODE_SESSION_ATTENDED: string;
	export const PYTHONSTARTUP: string;
	export const STARSHIP_SHELL: string;
	export const WAYLAND_DISPLAY: string;
	export const cmakeFlags: string;
	export const STARSHIP_CONFIG: string;
	export const CHATBOT_REQUEST_TIMEOUT_MS: string;
	export const GIO_EXTRA_MODULES: string;
	export const NIX_STORE: string;
	export const GIT_ASKPASS: string;
	export const DEVENV_ROOT: string;
	export const LD: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const SOPS_EDITOR: string;
	export const DIRENV_DIFF: string;
	export const READELF: string;
	export const CHATBOT_REASONING_SUMMARIES: string;
	export const CHROME_DESKTOP: string;
	export const GTK_A11Y: string;
	export const STARSHIP_SESSION_KEY: string;
	export const EGL_PLATFORM: string;
	export const XDG_CACHE_HOME: string;
	export const NIX_USER_PROFILE_DIR: string;
	export const INFOPATH: string;
	export const SVERLIN_TEST_BROWSER: string;
	export const VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
	export const USE_BUILTIN_RIPGREP: string;
	export const VSCODE_PYTHON_AUTOACTIVATE_GUARD: string;
	export const CLAUDE_CODE_SSE_PORT: string;
	export const TERM: string;
	export const DISABLE_INSTALLATION_CHECKS: string;
	export const PYTHON_BASIC_REPL: string;
	export const GTK_PATH: string;
	export const SIZE: string;
	export const ZDOTDIR: string;
	export const USER: string;
	export const SSH_ASKPASS_REQUIRE: string;
	export const BETTER_AUTH_TRUSTED_ORIGINS: string;
	export const VSCODE_GIT_IPC_HANDLE: string;
	export const NIX_LD: string;
	export const AR: string;
	export const AS: string;
	export const HYPRLAND_INSTANCE_SIGNATURE: string;
	export const DISPLAY: string;
	export const NIX_BINTOOLS_WRAPPER_TARGET_HOST_x86_64_unknown_linux_gnu: string;
	export const DEVENV_TASKS: string;
	export const DEVENV_RUNTIME: string;
	export const SHLVL: string;
	export const FOAM_WORKSPACE: string;
	export const MOZ_ENABLE_WAYLAND: string;
	export const NM: string;
	export const GIT_EDITOR: string;
	export const PAGER: string;
	export const __HM_ZSH_SESS_VARS_SOURCED: string;
	export const NIX_CFLAGS_COMPILE: string;
	export const QTWEBKIT_PLUGIN_PATH: string;
	export const __NIXOS_SET_ENVIRONMENT_DONE: string;
	export const XDG_VTNR: string;
	export const XDG_SESSION_ID: string;
	export const LOCALE_ARCHIVE: string;
	export const LESSKEYIN_SYSTEM: string;
	export const npm_config_user_agent: string;
	export const TERMINFO_DIRS: string;
	export const XDG_STATE_HOME: string;
	export const FC_FONTATIONS: string;
	export const LD_LIBRARY_PATH: string;
	export const DISABLE_AUTOUPDATER: string;
	export const DEVENV_PROFILE: string;
	export const XDG_RUNTIME_DIR: string;
	export const NIX_PKG_CONFIG_WRAPPER_TARGET_HOST_x86_64_unknown_linux_gnu: string;
	export const NODE_PATH: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const OBJCOPY: string;
	export const PGHOST: string;
	export const PGDATA: string;
	export const STRIP: string;
	export const VSCODE_GIT_ASKPASS_MAIN: string;
	export const XDG_DATA_DIRS: string;
	export const GDK_BACKEND: string;
	export const LIBEXEC_PATH: string;
	export const CLAUDE_CODE_EXECPATH: string;
	export const OBJDUMP: string;
	export const PATH: string;
	export const __GLX_VENDOR_LIBRARY_NAME: string;
	export const CC: string;
	export const NIX_CC: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const DIRENV_WATCHES: string;
	export const NIX_CC_WRAPPER_TARGET_HOST_x86_64_unknown_linux_gnu: string;
	export const DEVENV_STATE: string;
	export const CONFIG_SHELL: string;
	export const RANLIB: string;
	export const NIX_HARDENING_ENABLE: string;
	export const FORCE_AUTOUPDATE_PLUGINS: string;
	export const NIX_LDFLAGS: string;
	export const name: string;
	export const CLAUDE_CODE_MESSAGING_TOKEN: string;
	export const PKG_CONFIG: string;
	export const TERM_PROGRAM: string;
	export const TEST: string;
	export const VITEST: string;
	export const NODE_ENV: string;
	export const PROD: string;
	export const DEV: string;
	export const BASE_URL: string;
	export const MODE: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		SHELL: string;
		npm_command: string;
		BETTER_AUTH_SECRET: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		allowSubstitutes: string;
		USER_ZDOTDIR: string;
		GC_LARGE_ALLOC_WARN_INTERVAL: string;
		__ETC_PROFILE_DONE: string;
		COLORTERM: string;
		__HM_SESS_VARS_SOURCED: string;
		HYPRLAND_CMD: string;
		XDG_CONFIG_DIRS: string;
		CLAUDE_CODE_CHILD_SESSION: string;
		hardeningDisable: string;
		NIX_LD_LIBRARY_PATH: string;
		TERM_PROGRAM_VERSION: string;
		DATABASE_URL: string;
		configureFlags: string;
		XDG_BACKEND: string;
		mesonFlags: string;
		PKG_CONFIG_PATH: string;
		AI_AGENT: string;
		DIRENV_ACTIVE: string;
		DEVENV_TASK_FILE: string;
		CLAUDE_CODE_SESSION_ID: string;
		PGPORT: string;
		DEVENV_CMDLINE: string;
		DEVENV_DIRENVRC_VERSION: string;
		SYSTEMD_XKB_DIRECTORY: string;
		CLAUDE_PID: string;
		DIRENV_DIR: string;
		XDG_DATA_HOME: string;
		npm_config_verify_deps_before_run: string;
		STRINGS: string;
		CLAUDE_EFFORT: string;
		XCURSOR_PATH: string;
		OPENAI_API_KEY: string;
		LOCALE_ARCHIVE_2_27: string;
		LIBVA_DRIVER_NAME: string;
		HL_INITIAL_WORKSPACE_TOKEN: string;
		NO_AT_BRIDGE: string;
		BRIGHTDATA_API_TOKEN_FILE: string;
		BETTER_AUTH_URL: string;
		DIRENV_FILE: string;
		EDITOR: string;
		XDG_SEAT: string;
		PWD: string;
		NIX_PROFILES: string;
		SOURCE_DATE_EPOCH: string;
		LOGNAME: string;
		XDG_SESSION_TYPE: string;
		NIX_ENFORCE_NO_NATIVE: string;
		CUPS_DATADIR: string;
		MANPATH: string;
		NIX_PATH: string;
		CLAUDE_CODE_MESSAGING_SOCKET: string;
		NIXPKGS_CONFIG: string;
		CXX: string;
		system: string;
		NoDefaultCurrentDirectoryInExePath: string;
		FZF_DEFAULT_COMMAND: string;
		VSCODE_GIT_ASKPASS_NODE: string;
		DEVENV_DOTFILE: string;
		CLAUDECODE: string;
		VSCODE_INJECTION: string;
		DEVENV_DIRENVRC_ROLLING_UPGRADE: string;
		GTK2_RC_FILES: string;
		IN_NIX_SHELL: string;
		HOME: string;
		NIX_BINTOOLS: string;
		SSH_ASKPASS: string;
		LANG: string;
		NIXOS_OZONE_WL: string;
		LS_COLORS: string;
		_JAVA_AWT_WM_NONREPARENTING: string;
		XDG_CURRENT_DESKTOP: string;
		NH_FLAKE: string;
		CLAUDE_CODE_SESSION_ATTENDED: string;
		PYTHONSTARTUP: string;
		STARSHIP_SHELL: string;
		WAYLAND_DISPLAY: string;
		cmakeFlags: string;
		STARSHIP_CONFIG: string;
		CHATBOT_REQUEST_TIMEOUT_MS: string;
		GIO_EXTRA_MODULES: string;
		NIX_STORE: string;
		GIT_ASKPASS: string;
		DEVENV_ROOT: string;
		LD: string;
		pnpm_config_verify_deps_before_run: string;
		SOPS_EDITOR: string;
		DIRENV_DIFF: string;
		READELF: string;
		CHATBOT_REASONING_SUMMARIES: string;
		CHROME_DESKTOP: string;
		GTK_A11Y: string;
		STARSHIP_SESSION_KEY: string;
		EGL_PLATFORM: string;
		XDG_CACHE_HOME: string;
		NIX_USER_PROFILE_DIR: string;
		INFOPATH: string;
		SVERLIN_TEST_BROWSER: string;
		VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
		USE_BUILTIN_RIPGREP: string;
		VSCODE_PYTHON_AUTOACTIVATE_GUARD: string;
		CLAUDE_CODE_SSE_PORT: string;
		TERM: string;
		DISABLE_INSTALLATION_CHECKS: string;
		PYTHON_BASIC_REPL: string;
		GTK_PATH: string;
		SIZE: string;
		ZDOTDIR: string;
		USER: string;
		SSH_ASKPASS_REQUIRE: string;
		BETTER_AUTH_TRUSTED_ORIGINS: string;
		VSCODE_GIT_IPC_HANDLE: string;
		NIX_LD: string;
		AR: string;
		AS: string;
		HYPRLAND_INSTANCE_SIGNATURE: string;
		DISPLAY: string;
		NIX_BINTOOLS_WRAPPER_TARGET_HOST_x86_64_unknown_linux_gnu: string;
		DEVENV_TASKS: string;
		DEVENV_RUNTIME: string;
		SHLVL: string;
		FOAM_WORKSPACE: string;
		MOZ_ENABLE_WAYLAND: string;
		NM: string;
		GIT_EDITOR: string;
		PAGER: string;
		__HM_ZSH_SESS_VARS_SOURCED: string;
		NIX_CFLAGS_COMPILE: string;
		QTWEBKIT_PLUGIN_PATH: string;
		__NIXOS_SET_ENVIRONMENT_DONE: string;
		XDG_VTNR: string;
		XDG_SESSION_ID: string;
		LOCALE_ARCHIVE: string;
		LESSKEYIN_SYSTEM: string;
		npm_config_user_agent: string;
		TERMINFO_DIRS: string;
		XDG_STATE_HOME: string;
		FC_FONTATIONS: string;
		LD_LIBRARY_PATH: string;
		DISABLE_AUTOUPDATER: string;
		DEVENV_PROFILE: string;
		XDG_RUNTIME_DIR: string;
		NIX_PKG_CONFIG_WRAPPER_TARGET_HOST_x86_64_unknown_linux_gnu: string;
		NODE_PATH: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		OBJCOPY: string;
		PGHOST: string;
		PGDATA: string;
		STRIP: string;
		VSCODE_GIT_ASKPASS_MAIN: string;
		XDG_DATA_DIRS: string;
		GDK_BACKEND: string;
		LIBEXEC_PATH: string;
		CLAUDE_CODE_EXECPATH: string;
		OBJDUMP: string;
		PATH: string;
		__GLX_VENDOR_LIBRARY_NAME: string;
		CC: string;
		NIX_CC: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		DIRENV_WATCHES: string;
		NIX_CC_WRAPPER_TARGET_HOST_x86_64_unknown_linux_gnu: string;
		DEVENV_STATE: string;
		CONFIG_SHELL: string;
		RANLIB: string;
		NIX_HARDENING_ENABLE: string;
		FORCE_AUTOUPDATE_PLUGINS: string;
		NIX_LDFLAGS: string;
		name: string;
		CLAUDE_CODE_MESSAGING_TOKEN: string;
		PKG_CONFIG: string;
		TERM_PROGRAM: string;
		TEST: string;
		VITEST: string;
		NODE_ENV: string;
		PROD: string;
		DEV: string;
		BASE_URL: string;
		MODE: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
