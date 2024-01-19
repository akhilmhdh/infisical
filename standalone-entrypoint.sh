#!/bin/sh

cd frontend-build
scripts/initialize-standalone-build.sh

cd ../


# Add `npm run seed:run` to seed the database
exec npm run migration:latest && node dist/main.mjs

