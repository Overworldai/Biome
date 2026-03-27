#!/usr/bin/env node

/**
 * Release script: bumps version in package.json and server-components/pyproject.toml,
 * commits the change, and creates a git tag.
 *
 * Usage:
 *   node scripts/release.mjs           # print current version
 *   node scripts/release.mjs <version> # cut a release
 *
 * Example:
 *   node scripts/release.mjs 1.0.0
 *   node scripts/release.mjs v1.0.0-rc2
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

const rawVersion = process.argv[2]
if (!rawVersion) {
  console.log(pkg.version)
  process.exit(0)
}

// Strip leading 'v' if present
const version = rawVersion.replace(/^v/, '')

// Basic semver validation (with optional pre-release)
if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
  console.error(`Invalid version: "${version}"`)
  console.error('Expected format: MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-prerelease')
  process.exit(1)
}

const tag = `v${version}`

// Check for uncommitted changes
const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim()
if (status) {
  console.error('Working directory is not clean. Commit or stash your changes first.')
  console.error(status)
  process.exit(1)
}

// Check tag doesn't already exist
const existingTags = execSync('git tag -l', { cwd: root, encoding: 'utf-8' }).trim().split('\n')
if (existingTags.includes(tag)) {
  console.error(`Tag "${tag}" already exists.`)
  process.exit(1)
}

// Update package.json
const oldVersion = pkg.version
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`package.json: ${oldVersion} → ${version}`)

// Update server-components/pyproject.toml
const pyprojectPath = resolve(root, 'server-components/pyproject.toml')
const pyproject = readFileSync(pyprojectPath, 'utf-8')
const updatedPyproject = pyproject.replace(/^version\s*=\s*".*"$/m, `version = "${version}"`)
if (updatedPyproject === pyproject) {
  console.error('Failed to update version in pyproject.toml — no version field found.')
  process.exit(1)
}
writeFileSync(pyprojectPath, updatedPyproject)
const oldPyVersion = pyproject.match(/^version\s*=\s*"(.*)"$/m)?.[1]
console.log(`server-components/pyproject.toml: ${oldPyVersion} → ${version}`)

// Commit and tag
execSync('git add package.json server-components/pyproject.toml', { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "release: ${tag}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag -a "${tag}" -m "${tag}"`, { cwd: root, stdio: 'inherit' })

console.log()
console.log(`Created commit and tag ${tag}.`)
console.log()
console.log('To push:')
console.log(`  git push origin main --follow-tags`)
