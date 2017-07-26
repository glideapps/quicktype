module Types where

import Prelude

import Data.Set (Set())
import Data.List (List())
import Data.Maybe (Maybe())

import IRGraph

type Renderer = {
    name :: String,
    extension :: String,
    aceMode :: String,
    render :: IRGraph -> String
}

type RendererTransformations = {
    nameForClass :: IRClassData -> String,
    unionName :: List String -> String,
    unionPredicate :: IRType -> Maybe (Set IRType),
    nextNameToTry :: String -> String,
    forbiddenNames :: Array String
}