/* @flow */

import type {Umzug} from 'umzug'
import chokidar from 'chokidar'
import path from 'path'
import PQueue from 'p-queue'
import chalk from 'chalk'
import fs from 'fs'
import promisify from 'es6-promisify'
import {spawn} from 'promisify-child-process'

declare class Watcher extends events$EventEmitter {
  close(): void;
}

type Migration = {
  path: string,
  file: string,
}

function watchMigrations(umzug: Umzug): Watcher {
  const {options: {migrations}} = umzug

  if (!migrations) throw new Error("couldn't get migrations configuration from umzug")

  const {pattern, traverseDirectories} = migrations
  if (!migrations.path) throw new Error("couldn't get migrations path from umzug")

  const queue = new PQueue({concurrency: 1})

  const watchPath = traverseDirectories ? migrations.path : path.resolve(migrations.path, '*')

  const watcher = chokidar.watch(
    watchPath,
    {
      ignored: pattern
        ? (file: string) => (
          file !== watchPath &&
          file !== migrations.path &&
          (!pattern || !pattern.test(path.relative(migrations.path, file)))
        )
        : null,
    }
  )

  function log(...args: Array<any>) {
    console.error(chalk.bold('[umzug-beobachten]'), ...args) // eslint-disable-line no-console
  }

  async function apply(file: string): Promise<void> {
    let stat
    try {
      stat = await promisify(fs.stat)(file)
    } catch (error) {
      stat = null
    }
    if ((stat && stat.isDirectory()) || (pattern && !pattern.test(path.basename(file)))) {
      return
    }

    try {
      const {stdout} = await spawn('git', ['status', '-s', file])
      const output = stdout ? (stdout: any).toString('utf8').trim() : ''
      if (output && !/^\s*\?/.test(output)) {
        log(chalk.bold.red(`warning: the migration you are changing (${file}) is already being tracked by git.  Make sure you know what you're doing, especially if the migration has already been applied outside your local dev environment.`))
      }
    } catch (error) {
      // ignore
    }

    await queue.add(async (): Promise<void> => {
      const executed: Set<string> = new Set((await umzug.executed()).map((migration: Migration) => migration.file))
      const migrations: Array<Migration> = await umzug._findMigrations()
      const index = migrations.findIndex(migration => migration.file === path.basename(file))
      if (index < 0) return
      try {
        log('Undoing migrations...')
        await umzug.down({
          migrations: migrations
            .slice(index)
            .map(migration => migration.file)
            .filter(file => executed.has(file))
            .reverse(),
        })
        migrations.forEach(migration => delete require.cache[migration.path])
        log('Reapplying migrations...')
        await umzug.up({
          migrations: migrations
            .slice(stat == null ? index + 1 : index)
            .map(migration => migration.file),
        })
      } catch (error) {
        log(error.stack)
      }
    })
  }

  watcher.on('ready', () => {
    log('watching', watchPath)
    watcher.on('add', (file: string) => {
      log('added:', file)
      apply(file)
    })
    watcher.on('change', (file: string) => {
      log('changed:', file)
      apply(file)
    })
    watcher.on('unlink', (file: string) => {
      log(chalk.yellow(`warning: ${file} was deleted, but umzug-beobachten doesn't handle deletions`))
    })
  })

  return watcher
}

module.exports = watchMigrations

