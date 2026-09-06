import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	...baseConfig,
	{
		// node:test's describe()/it() return promises that are intentionally not awaited
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			// eslint-plugin-n cannot resolve the plain .mjs helper imported by the versioning test
			'n/no-missing-import': 'off',
		},
	},
]
