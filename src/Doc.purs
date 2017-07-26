module Doc
    ( Doc
    , Renderer
    , Transforms
    , getGraph
    , getClasses
    , getClass
    , getClassNames
    , getUnions
    , getUnionNames
    , lookupName
    , lookupClassName
    , lookupUnionName
    , string
    , line
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    , runRenderer
    , typeNameForUnion
    ) where

import IR
import IRGraph
import Prelude

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Foldable (for_, intercalate, sequence_)
import Data.List (List)
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe, fromMaybe)
import Data.Set (Set)
import Data.Set as S
import Data.String as String
import Data.Tuple (Tuple(..), snd)

type Renderer = {
    name :: String,
    extension :: String,
    aceMode :: String,
    doc :: Doc Unit,
    transforms :: Transforms
}

type Transforms = {
    nameForClass :: IRClassData -> String,
    unionName :: List String -> String,
    unionPredicate :: IRType -> Maybe (Set IRType),
    nextNameToTry :: String -> String,
    forbiddenNames :: Array String
}

type DocState = { indent :: Int }

type DocEnv = { graph :: IRGraph, classNames ::  Map Int String, unionNames :: Map (Set IRType) String, unions :: List (Set IRType) }

newtype Doc a = Doc (RWS DocEnv String DocState a)

derive newtype instance functorDoc :: Functor Doc
derive newtype instance applyDoc :: Apply Doc
derive newtype instance applicativeDoc :: Applicative Doc
derive newtype instance bindDoc :: Bind Doc
derive newtype instance monadDoc :: Monad Doc

runRenderer :: Renderer -> IRGraph -> String
runRenderer { doc, transforms } = runDoc doc transforms

runDoc :: forall a. Doc a -> Transforms -> IRGraph -> String
runDoc (Doc w) t graph =
    let classes = classesInGraph graph
        forbidden = S.fromFoldable t.forbiddenNames
        classNames = transformNames t.nameForClass t.nextNameToTry forbidden classes
        unions = L.fromFoldable $ filterTypes t.unionPredicate graph
        forbiddenForUnions = S.union forbidden $ S.fromFoldable $ M.values classNames
        nameForUnion s = t.unionName $ map (typeNameForUnion graph) $ L.sort $ L.fromFoldable s
        unionNames = transformNames nameForUnion t.nextNameToTry forbiddenForUnions $ map (\s -> Tuple s s) unions
    in
        evalRWS w { graph, classNames, unionNames, unions } { indent: 0 } # snd        

typeNameForUnion :: IRGraph -> IRType -> String
typeNameForUnion graph = case _ of
    IRNothing -> "nothing"
    IRNull -> "null"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> typeNameForUnion graph a <> "_array"
    IRClass i ->
        let IRClassData { names } = getClassFromGraph graph i
        in
            combineNames names
    IRMap t -> typeNameForUnion graph t <> "_map"
    IRUnion _ -> "union"

getGraph :: Doc IRGraph
getGraph = Doc (asks _.graph)

getClassNames :: Doc (Map Int String)
getClassNames = Doc (asks _.classNames)

getUnions :: Doc (List (Set IRType))
getUnions = Doc (asks _.unions)

getUnionNames :: Doc (Map (Set IRType) String)
getUnionNames = Doc (asks _.unionNames)

getClasses :: Doc (L.List (Tuple Int IRClassData))
getClasses = classesInGraph <$> getGraph

getClass :: Int -> Doc IRClassData
getClass i = do
  graph <- getGraph
  pure $ getClassFromGraph graph i

lookupName :: forall a. Ord a => a -> Map a String -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ M.lookup original nameMap

lookupClassName :: Int -> Doc String
lookupClassName i = do
    classNames <- getClassNames
    pure $ lookupName i classNames

lookupUnionName :: Set IRType -> Doc String
lookupUnionName s = do
    unionNames <- getUnionNames
    pure $ lookupName s unionNames

-- Given a potentially multi-line string, render each line at the current indent level
line :: String -> Doc Unit
line s = do
    indent <- Doc (gets _.indent)
    let whitespace = times "\t" indent
    let lines = String.split (String.Pattern "\n") s
    for_ lines \l -> do
        string whitespace
        string l
        string "\n"  

-- Cannot make this work any other way!
times :: String -> Int -> String
times s n | n < 1 = ""
times s 1 = s
times s n = s <> times s (n - 1)

string :: String -> Doc Unit
string = Doc <<< tell

blank :: Doc Unit
blank = string "\n"

indent :: forall a. Doc a -> Doc a
indent doc = do
    Doc $ modify (\s -> { indent: s.indent + 1 })
    a <- doc
    Doc $ modify (\s -> { indent: s.indent - 1 })
    pure a