module Swift
    ( renderSwiftClass
    ) where

import Doc
import IR
import Prelude

import Data.Foldable (for_, intercalate)
import Data.Function (on)
import Data.List (List(..), groupBy)
import Data.List as L
import Data.List.NonEmpty as NE

renderSwiftClass :: IRClassData -> Doc Unit
renderSwiftClass { name, properties } = do
    line $ words ["struct", name]
    line "{"
    indent do
        let propGroups = L.groupBy (eq `on` _.typ) properties
        for_ propGroups renderPropGroup
    line "}"

renderPropGroup :: NE.NonEmptyList IRProperty -> Doc Unit
renderPropGroup props = line do
    let names = intercalate ", " (_.name <$> props)
    words ["let", names <> ":"]
    string " "

    let { typ } = NE.head props
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