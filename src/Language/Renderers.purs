module Language.Renderers
    ( all
    , rendererForLanguage
    ) where

import Language.Elm as Elm
import Language.Java as Java
import Language.CSharp as CSharp
import Language.Golang as Golang
import Language.TypeScript as TypeScript
import Language.Swift as Swift
import Language.JsonSchema as JsonSchema
import Language.SimpleTypes as SimpleTypes

import Doc as Doc

import Data.Maybe (Maybe)
import Data.Foldable (elem, find)

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

rendererForLanguage :: String -> Maybe Doc.Renderer
rendererForLanguage language =
    find match all
    where
        match :: Doc.Renderer -> Boolean
        match { names } = elem language names
