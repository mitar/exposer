#!/bin/bash -e

# An example script to run Exposer in production. It uses data volumes under the $DATA_ROOT directory.
# By default /srv. You can provide a configuration.sh script which should export environment variables
# to configure Exposer. See settings.js file for the list of possible variables.

export NAME='exposer'
export DATA_ROOT='/srv'
export MONGODB_DATA="${DATA_ROOT}/${NAME}/mongodb/data"
export MONGODB_LOG="${DATA_ROOT}/${NAME}/mongodb/log"

export EXPOSER_LOG="${DATA_ROOT}/${NAME}/exposer/log"
export EXPOSER_CONFIGURATION="${DATA_ROOT}/${NAME}/configuration.sh"

mkdir -p "$MONGODB_DATA"
mkdir -p "$MONGODB_LOG"
mkdir -p "$EXPOSER_LOG"

touch "$EXPOSER_CONFIGURATION"

docker run --detach=true --restart=always --name "${NAME}_mongodb" --volume "${MONGODB_LOG}:/var/log/mongod" --volume "${MONGODB_DATA}:/var/lib/mongodb" tozd/mongodb:2.4
docker run --detach=true --restart=always --name "${NAME}_exposer" --env VIRTUAL_HOST="${NAME}.tnode.com" --env VIRTUAL_URL=/ --volume "${EXPOSER_LOG}:/var/log/exposer" --volume "${EXPOSER_CONFIGURATION}:/etc/service/exposer/run.initialization" --link "${NAME}_mongodb:mongodb" mitar/exposer
