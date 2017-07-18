module Swift
    ( renderSwiftClass
    ) where

import Prelude

import Doc
import IR

import Data.Foldable (for_, intercalate)
import Data.Function (on)

import Data.List as L
import Data.List.NonEmpty as NE

import Data.Map as M

import Data.Set as S
import Data.Tuple (Tuple(..))


renderSwiftClass :: IRGraph -> IRClassData -> Doc Unit
renderSwiftClass graph (IRClassData { names, properties }) = do
    line $ words ["struct", combineNames names]
    line "{"
    indent do
        let props = properties # M.toUnfoldable <#> \(Tuple name typ) -> { name, typ }
        let propGroups = L.groupBy (eq `on` _.typ) props
        for_ propGroups (renderPropGroup graph)
    line "}"
    
    blank

    for_ (M.values properties) (renderUnions graph)

renderPropGroup :: IRGraph -> NE.NonEmptyList { name :: String, typ :: IRType} -> Doc Unit
renderPropGroup graph props = line do
    let names = intercalate ", " (_.name <$> props)
    words ["let", names <> ":"]
    string " "

    let { typ } = NE.head props
    string $ renderType graph typ

renderType :: IRGraph -> IRType -> String
renderType graph = case _ of
    IRNothing -> "Any"
    IRNull -> "Any?"
    IRInteger -> "Int"
    IRDouble -> "Double"
    IRBool -> "Bool"
    IRString -> "String"
    IRArray a -> "[" <> renderType graph a <> "]"
    IRClass i ->
        let IRClassData { names, properties } = getClassFromGraph graph i
        in
            combineNames names
    IRUnion s ->  unionName graph s

renderUnions :: IRGraph -> IRType -> Doc Unit
renderUnions graph = case _ of
    IRUnion s -> do
        renderUnion graph s
        for_ (S.toUnfoldable s :: Array _) (renderUnions graph)
    IRArray (IRUnion s) -> renderUnion graph s
    _ -> pure unit

unionName :: IRGraph -> S.Set IRType -> String
unionName graph s = intercalate "Or" $ (caseName graph <$> S.toUnfoldable s :: Array _)

caseName :: IRGraph -> IRType -> String
caseName graph = case _ of
    IRArray a -> renderType graph a <> "s"
    IRNull -> "Nullable"
    t -> renderType graph t

renderUnion :: IRGraph -> S.Set IRType -> Doc Unit
renderUnion graph types = do
    line $ words ["enum", unionName graph types, "{"]
    indent do
        for_ types \typ -> line do
            string "case ."
            string $ "some" <> caseName graph typ
            string "("
            string $ renderType graph typ
            string ")"
    line "}"
    blank

