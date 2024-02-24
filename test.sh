#!/bin/sh
version=$(cat version.txt)
docker run --env-file ./.env web-watcher:$version 