[![npm version](https://badge.fury.io/js/quicktype.svg)](https://badge.fury.io/js/quicktype)
[![Build Status](https://travis-ci.org/quicktype/quicktype.svg?branch=master)](https://travis-ci.org/quicktype/quicktype)
[![Join us in Slack](http://slack.quicktype.io/badge.svg)](http://slack.quicktype.io/)

## Synopsis

```
$ quicktype [--lang cs|go|c++|java|ts|swift|elm|schema|types] FILE|URL ... 
```

## Description

  Given JSON sample data, quicktype outputs code for working with that data in  
  C#, Go, C++, Java, TypeScript, Swift, Elm, JSON Schema, Simple Types.         

## Options

```
  -o, --out FILE                                       The output file. Determines --lang and --top-level
  -t, --top-level NAME                                 The name for the top level type.            
  -l, --lang cs|go|c++|java|ts|swift|elm|schema|types  The target language.                        
  -s, --src-lang json|schema                           The source language (default is json).      
  --src FILE|URL|DIRECTORY                              The file, url, or data directory to type.   
  --src-urls FILE                                       Tracery grammar describing URLs to crawl.   
  --no-combine-classes                                  Don't combine similar classes.              
  --no-maps                                             Don't infer maps, always use classes.       
  --no-enums                                            Don't infer enums, always use strings.      
  --quiet                                               Don't show issues in the generated code.    
  -h, --help                                           Get some help.                              
```

### Options for C#

```
  --namespace NAME                                 Generated namespace 
  --csharp-version 6|5                             C# version          
  --density normal|dense                           Property density    
  --array-type array|list                          Use T[] or List<T>  
  --features complete|attributes-only|just-types   Output features     
```

### Options for Go

```
  --package NAME   Generated package name 
```

### Options for C++

```
  --namespace NAME                                                                  Name of the     
                                                                                    generated       
                                                                                    namespace       
  --type-style pascal-case|underscore-case|camel-case|upper-underscore-case         Naming style    
                                                                                    for types       
  --member-style underscore-case|pascal-case|camel-case|upper-underscore-case       Naming style    
                                                                                    for members     
  --enumerator-style upper-underscore-case|underscore-case|pascal-case|camel-case   Naming style    
                                                                                    for enumerators 
  --unions containment|indirection                                                  Use containment 
                                                                                    or indirection  
                                                                                    for unions      
```

### Options for Java

```
  --package NAME   Generated package name 
  --just-types     Plain types only       
```

### Options for TypeScript

```
  --just-types           Interfaces only                      
  --explicit-unions      Explicitly name unions               
  --runtime-typecheck    Assert JSON.parse results at runtime 
```

### Options for Swift

```
  --just-types                     Plain types only            
  --struct-or-class struct|class   Generate structs or classes 
```

### Options for Elm

```
  --module NAME             Generated module name 
  --array-type array|list   Use Array or List     
```

### Options for Simple Types

```
  --declare-unions    Declare unions as named types 
```

## Examples

### Generate C# to parse a Bitcoin API
```
  $ quicktype -o LatestBlock.cs https://blockchain.info/latestblock             
```

### Generate Go code from a directory of samples containing:
```
  - Foo.json                                                                    
  + Bar                                                                         
  - bar-sample-1.json                                                           
  - bar-sample-2.json                                                           
  - Baz.url 
```
```
  $ quicktype -l go samples                                                     
```

### Generate JSON Schema, then TypeScript  

```
  $ quicktype -o schema.json https://blockchain.info/latestblock                
  $ quicktype -o bitcoin.ts --src-lang schema schema.json                       
```

Learn more at [quicktype.io](https://quicktype.io)

