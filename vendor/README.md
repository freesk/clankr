# vendor/

Third-party assets the harness reads from disk at run time (SEC-3, D31). Everything here except this file is installed by `npm run vendor` and is not committed.

Each part that needs an asset adds a `VendorStep` under `scripts/vendor/` and lists it in `scripts/vendor/steps.ts`. A step pins a version, verifies a checksum, and installs into `vendor/<name>/`. A `VERSION` file records what was installed.

The harness never fetches anything at run time. If an asset is missing, it fails with a message telling the user to run `npm run vendor`.
