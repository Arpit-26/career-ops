#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
& "$basedir/agy-bridge.mjs" $args
exit $LASTEXITCODE
