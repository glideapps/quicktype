module Swift
    ( renderSwiftClass
    ) where

import Prelude

import Data.Foldable (for_)

import Data.List as L
import Data.List (List(..))

import Doc
import IR

renderSwiftClass :: IRClassData -> Doc Unit
renderSwiftClass { name, properties } = do
    line $ words ["class", name]
    line "{"
    indent do
        for_ properties renderProperty
    line "}"

renderProperty :: IRProperty -> Doc Unit
renderProperty { name, typ } = line do
    words ["let", name <> ":"]
    string " "
    string $ renderType typ

renderType :: IRType -> String
renderType = case _ of
    IRNothing -> "Any"
    IRNull -> "Any"
    IRInteger -> "Int"
    IRDouble -> "Double"
    IRBool -> "Bool"
    IRString -> "String"
    IRArray a -> "[" <> renderType a <> "]"
    IRClass { name } -> name
    IRUnion _ -> "FIXME"