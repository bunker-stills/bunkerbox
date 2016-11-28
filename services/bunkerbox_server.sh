#!/usr/bin/env bash

if [ -z ${DEVICE_ID+x} ]; then

DBUS_SYSTEM_BUS_ADDRESS=unix:path=/host_run/dbus/system_bus_socket \
  dbus-send \
  --system \
  --print-reply \
  --reply-timeout=2000 \
  --type=method_call \
  --dest=org.freedesktop.hostname1 \
  /org/freedesktop/hostname1 \
  org.freedesktop.hostname1.SetStaticHostname \
  string:"${DEVICE_ID}" boolean:true

fi