#!/bin/sh

cd frontend-build
scripts/initialize-standalone-build.sh

cd ../

# npm run migration:latest     # Uncomment to run database migrations automatically on startup.
# npm run seed:run             # Uncomment to add seed data to the database.
exec node dist/main.js

