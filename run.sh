#!/bin/bash -e

# An example script to run Exposer in production. It uses data volumes under the $DATA_ROOT directory
# by default /srv. You can provide a configuration.sh script which should export environment variables
# to configure Exposer. See settings.js file for the list of possible variables.

export NAME='exposer'
export DATA_ROOT='/srv'
export MONGODB_DATA="$DATA_ROOT/${NAME}/mongodb/data"
export MONGODB_LOG="$DATA_ROOT/${NAME}/mongodb/log"

export EXPOSER_LOG="$DATA_ROOT/${NAME}/exposer/log"
export EXPOSER_CONFIGURATION="$DATA_ROOT/${NAME}/configuration.sh"

mkdir -p "$MONGODB_DATA"
mkdir -p "$MONGODB_LOG"
mkdir -p "$EXPOSER_LOG"

touch "$CONFIGURATION"

docker run --detach=true --restart=always --name "${NAME}_mongodb" --volume "${MONGODB_LOG}:/var/log/mongod" --volume "${MONGODB_DATA}:/var/lib/mongodb" tozd/mongodb 
docker run --detach=true --restart=always --name "${NAME}_exposer" --volume "${EXPOSER_LOG}:/var/log/exposer" --volume "${CONFIGURATION}:/etc/service/exposer/run.initialization" --link "${NAME}_mongodb:mongodb" mitar/exposer