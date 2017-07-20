module Swift
    ( renderer
    ) where

import Prelude

import Doc
import IRGraph
import Types

import Data.Foldable (for_, intercalate)
import Data.Function (on)

import Data.List as L
import Data.List.NonEmpty as NE

import Data.Map as M

import Data.Set as S
import Data.Tuple (Tuple(..))

renderer :: Renderer
renderer =
    { name: "Swift"
    , aceMode: "swift"
    , doc: swiftDoc
    }

swiftDoc :: Doc Unit
swiftDoc = do
    lines "import Foundation"
    blank
    classes <- getClasses
    for_ classes \cls -> do
        renderSwiftClass cls
        blank

renderSwiftClass :: IRClassData -> Doc Unit
renderSwiftClass (IRClassData { names, properties }) = do
    line $ words ["struct", combineNames names]
    
    lines "{"
    indent do
        let props = properties # M.toUnfoldable <#> \(Tuple name typ) -> { name, typ }
        let propGroups = L.groupBy (eq `on` _.typ) props
        for_ propGroups renderPropGroup
    lines "}"
    
    blank

    for_ (M.values properties) renderUnions

renderPropGroup :: NE.NonEmptyList { name :: String, typ :: IRType} -> Doc Unit
renderPropGroup props = line do
    let names = intercalate ", " (_.name <$> props)
    words ["let", names <> ": "]

    let { typ } = NE.head props
    graph <- getGraph
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
        let IRClassData { names } = getClassFromGraph graph i
        in combineNames names
    IRMap t -> "[String: " <> renderType graph t <> "]"
    IRUnion s -> unionName graph s

renderUnions :: IRType -> Doc Unit
renderUnions = case _ of
    IRUnion s -> do
        renderUnion s
        for_ (S.toUnfoldable s :: Array _) renderUnions
    IRArray (IRUnion s) -> renderUnion s
    _ -> pure unit

unionName :: IRGraph -> S.Set IRType -> String
unionName graph s = intercalate "Or" $ (caseName graph <$> S.toUnfoldable s :: Array _)

caseName :: IRGraph -> IRType -> String
caseName graph = case _ of
    IRArray a -> renderType graph a <> "s"
    IRNull -> "Nullable"
    t -> renderType graph t

renderUnion :: S.Set IRType -> Doc Unit
renderUnion types = do
    graph <- getGraph
    
    line $ words ["enum", unionName graph types, "{"]

    indent do
        for_ types \typ -> line do
            string "case ."
            string $ "some" <> caseName graph typ
            string "("
            string $ renderType graph typ
            string ")"
    lines "}"
    blank

