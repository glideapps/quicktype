module Language.Renderers (all) where

import Language.Elm as Elm
import Language.Java as Java
import Language.CSharp as CSharp
import Language.Golang as Golang
import Language.TypeScript as TypeScript
import Language.Swift as Swift
import Language.JsonSchema as JsonSchema
import Language.SimpleTypes as SimpleTypes

import Doc as Doc

all :: Array Doc.Renderer
all = 
    [ TypeScript.renderer
    , Golang.renderer
    , CSharp.renderer
    , Java.renderer
    , Elm.renderer
    , Swift.renderer
    , SimpleTypes.renderer
    , JsonSchema.renderer
    ]