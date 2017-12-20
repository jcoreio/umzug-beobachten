// @flow

import {describe, it, beforeEach, afterEach} from 'mocha'
import {expect} from 'chai'
import fs from 'fs-extra'
import path from 'path'
import Umzug from 'umzug'
import sinon from 'sinon'
import emitted from 'promisify-event'
import watchMigrations from '../src'
import delay from 'delay'
import stripAnsi from 'strip-ansi'

const migrationLog: Array<[string, 'up' | 'down', number]> = []

exports.migrationLog = migrationLog

function makeMigration(rev: number): string {
  return `
/* eslint-disable */
'use strict'

module.exports = {
  up: function () {
    require(${JSON.stringify(__filename)}).migrationLog.push([__filename, 'up', ${rev}]) 
  },
  down: function () {
    require(${JSON.stringify(__filename)}).migrationLog.push([__filename, 'down', ${rev}]) 
  },
}
`
}

describe('watchMigrations', function () {
  this.timeout(15000)

  let umzug
  let watcher
  let storageFile
  let migrationsDir
  let intervals = []

  beforeEach(async function (): Promise<void> {
    intervals = []

    migrationLog.splice(0, migrationLog.length)

    const {title} = this.currentTest
    storageFile = path.join(__dirname, 'storage', `${title}.json`)
    migrationsDir = path.join(__dirname, 'migrations', title)

    await fs.mkdirs(path.dirname(storageFile))
    await fs.remove(migrationsDir)
    await fs.mkdirs(migrationsDir)

    await fs.remove(storageFile)
    umzug = new Umzug({
      storage: 'json',
      storageOptions: {
        path: storageFile,
      },
      migrations: {
        path: migrationsDir,
      }
    })

    sinon.spy(umzug, 'up')
    sinon.spy(umzug, 'down')

    sinon.spy(console, 'error') // eslint-disable-line no-console
  })
  afterEach(() => {
    intervals.forEach(interval => clearInterval(interval))
    if (watcher) watcher.close()
    watcher = null
    console.error.restore() // eslint-disable-line no-console
  })

  function poll(condition: Function): Promise<void> {
    return new Promise((resolve: () => void, reject: (error: Error) => void) => {
      const interval = setInterval(async (): Promise<void> => {
        try {
          if (await condition()) {
            clearInterval(interval)
            resolve()
          }
        } catch (error) {
          clearInterval(interval)
          reject(error)
        }
      }, 20)
      intervals.push(interval)
    })
  }

  it('runs added migrations', async function (): Promise<void> {
    watcher = watchMigrations(umzug)
    await emitted(watcher, 'ready')

    const migrationFile = path.join(migrationsDir, '0-migration1.js')
    await fs.writeFile(migrationFile, makeMigration(0), 'utf8')

    await poll(() => umzug.up.called)
    await Promise.all(umzug.up.returnValues)
    if (umzug.down.called) {
      expect(umzug.down.args).to.deep.equal([[
        {migrations: []}
      ]])
    }
    expect(umzug.up.called).to.be.true
    expect(umzug.up.args).to.deep.equal([[
      {migrations: [path.basename(migrationFile)]}
    ]])

    expect(migrationLog).to.deep.equal([
      [migrationFile, 'up', 0]
    ])

    umzug.down.reset()
    umzug.up.reset()

    const migrationFile2 = path.join(migrationsDir, '1-migration2.js')
    await fs.writeFile(migrationFile2, makeMigration(0), 'utf8')

    await poll(() => umzug.up.called)
    if (umzug.down.called) {
      expect(umzug.down.args).to.deep.equal([[
        {migrations: []}
      ]])
    }
    expect(umzug.up.called).to.be.true
    await Promise.all(umzug.up.returnValues)
    expect(umzug.up.args).to.deep.equal([[
      {migrations: [path.basename(migrationFile2)]}
    ]])

    expect(migrationLog).to.deep.equal([
      [migrationFile, 'up', 0],
      [migrationFile2, 'up', 0],
    ])
  })
  it('runs changed migrations', async function (): Promise<void> {
    const migrationFiles = [
      '0-migration0.js',
      '1-migration1.js',
      '2-migration2.js',
    ]
    const absoluteMigrationFiles = migrationFiles.map(file => path.join(migrationsDir, file))
    await Promise.all(absoluteMigrationFiles.map(file => fs.writeFile(file, makeMigration(0), 'utf8')))
    await umzug.up()

    expect(migrationLog).to.deep.equal([
      ...absoluteMigrationFiles.map(file => [file, 'up', 0]),
    ])

    umzug.up.reset()

    watcher = watchMigrations(umzug)
    await emitted(watcher, 'ready')

    await fs.writeFile(absoluteMigrationFiles[1], makeMigration(1), 'utf8')

    await poll(() => umzug.up.called)
    await Promise.all(umzug.up.returnValues)
    if (umzug.down.called) {
      expect(umzug.down.args).to.deep.equal([[
        {migrations: migrationFiles.slice(1).reverse()}
      ]])
    }
    expect(umzug.up.called).to.be.true
    expect(umzug.up.args).to.deep.equal([[
      {migrations: migrationFiles.slice(1)}
    ]])

    expect(migrationLog).to.deep.equal([
      ...absoluteMigrationFiles.map(file => [file, 'up', 0]),
      ...absoluteMigrationFiles.slice(1).reverse().map(file => [file, 'down', 0]),
      [absoluteMigrationFiles[1], 'up', 1],
      ...absoluteMigrationFiles.slice(2).map(file => [file, 'up', 0]),
    ])
  })
  it("ignores added directory", async function (): Promise<void> {
    watcher = watchMigrations(umzug)
    await emitted(watcher, 'ready')

    await fs.mkdirs(path.join(migrationsDir, "0-gotcha.js"))
    await delay(1000)

    expect(umzug.down.called).to.be.false
    expect(umzug.up.called).to.be.false
  })

  it('warns about changes to migrations tracked by git', async function (): Promise<void> {
    migrationsDir = path.join(__dirname, 'committedMigrations')
    const migrationFile = path.join(migrationsDir, '0-migration.js')

    umzug = new Umzug({
      storage: 'json',
      storageOptions: {
        path: storageFile,
      },
      migrations: {
        path: migrationsDir,
      }
    })

    await umzug.up()

    sinon.spy(umzug, 'up')
    sinon.spy(umzug, 'down')

    watcher = watchMigrations(umzug)
    await emitted(watcher, 'ready')

    const previousContent = await fs.readFile(migrationFile, 'utf8')
    try {
      await fs.writeFile(migrationFile, makeMigration(0), 'utf8')

      await poll(() => umzug.up.called)
      await Promise.all(umzug.up.returnValues)

      let warningFound = false
      for (let args of console.error.args) { // eslint-disable-line no-console
        if (/warning: the migration you are changing .* is already being tracked by git./.test(stripAnsi(args.join(' ')))) {
          warningFound = true
          break
        }
      }
      expect(warningFound).to.be.true
    } finally {
      await fs.writeFile(migrationFile, previousContent, 'utf8')
    }
  })
})

