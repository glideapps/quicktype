
# quicktype

  Quickly generate types from data.

## Options

```
--src file|url                  The JSON file or url to type.    
-o, --out file                 The output file.                 
-s, --src-lang json|schema     The source language.             
-l, --lang ts|go|cs|elm|json   The target language.             
-t, --top-level name           The name for the top level type. 
-h, --help                     Get some help.                   
```

## Examples

#### Generate C# to parse a BitCoin API

```shell
$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock 
```

#### Generate Go code to parse `users.json`:

```shell
$ quicktype --lang go users.json
```

This will produce `user.go`.

#### Generate JSON Schema, then TypeScript

```shell
$ quicktype https://blockchain.info/latestblock -o schema.json
$ # ... audit schema.json
$ quicktype schema.json -s schema -o bitcoin.ts
```