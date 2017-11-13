module Language.Renderers
    ( all
    , rendererForLanguage
    ) where

import Language.Elm as Elm
import Language.Swift as Swift
import Language.JsonSchema as JsonSchema

import Doc as Doc

import Data.Maybe (Maybe)
import Data.Foldable (elem, find)

all :: Array Doc.Renderer
all = 
    [ Elm.renderer
    , Swift.renderer
    , JsonSchema.renderer
    ]

rendererForLanguage :: String -> Maybe Doc.Renderer
rendererForLanguage language =
    find match all
    where
        match :: Doc.Renderer -> Boolean
        match { names } = elem language names
