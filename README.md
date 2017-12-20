# umzug-beobachten

[![Build Status](https://travis-ci.org/jcoreio/umzug-beobachten.svg?branch=master)](https://travis-ci.org/jcoreio/umzug-beobachten)
[![Coverage Status](https://codecov.io/gh/jcoreio/umzug-beobachten/branch/master/graph/badge.svg)](https://codecov.io/gh/jcoreio/umzug-beobachten)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)

Watch your umzug migration directory and undo/redo when files change.
This is intended for development mode only.

# Installation

```sh
npm install --save-dev umzug-beobachten
```

# Usage

```js
const Umzug = require('umzug')
const watchMigrations = require('umzug-beobachten')

const umzug = new Umzug({
  ...
})

if (process.env.NODE_ENV !== 'production') {
  const watcher = watchMigrations(umzug)

  // that's it!  Now if you create a migration file the watcher will
  // automatically run it, and if you change a migration file, the
  // watcher will undo back to before that migration, run the new version,
  // and then rerun all the migrations after it.

  ...
  // if you need to stop the watcher later without killing the process:
  watcher.close()
}
```

