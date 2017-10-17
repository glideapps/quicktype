
## Synopsis

```
$ quicktype [--lang cs|ts|go|java|elm|swift|types|schema] FILE|URL ... 
```

## Description

  Given JSON sample data, quicktype outputs code for working with that data in  
  C#, TypeScript, Go, Java, Elm, Swift, Simple Types, Schema.                   

## Options

```
-o, --out FILE                                    The output file. Determines --lang and --top-level. 
-t, --top-level NAME                              The name for the top level type.                    
-l, --lang cs|ts|go|java|elm|swift|types|schema   The target language.                                
-s, --src-lang json|schema                        The source language (default is json).              
--src FILE|URL                                    The file or url to type.                            
--src-urls FILE                                   Tracery grammar describing URLs to crawl.           
--no-maps                                         Don't infer maps, always use classes.               
-h, --help                                        Get some help.                                
```    

### Options for C#
```
--namespace NAME                                 Generated namespace 
--csharp-version 6|5                             C# version          
--density normal|dense                           Property density    
--array-type array|list                          Use T[] or List<T>  
--features complete|attributes-only|just-types   Output features     
```

### Options for TypeScript
```
--just-types yes|no   Plain interfaces only 
```

### Options for Go
```
--package NAME   Generated package name 
```

### Options for Java
```
--package NAME        Generated package name 
--just-types yes|no   Plain objects only     
```

### Options for Elm
```
--module NAME             Generated module name 
--array-type array|list   Use Array or List     
```

### Options for Swift

```
--swift-version 4|3              Swift version               
--struct-or-class struct|class   Generate structs or classes 
--just-types yes|no              Plain types only            
```

### Examples

```
Generate C# to parse a Bitcoin API                                
$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock 
                                                                    
Generate Go code from a JSON file                                 
$ quicktype -l go user.json                                       
                                                                    
Generate JSON Schema, then TypeScript                             
$ quicktype -o schema.json https://blockchain.info/latestblock    
$ quicktype -o bitcoin.ts --src-lang schema schema.json           
```

Learn more at [quicktype.io](https://quicktype.io)
