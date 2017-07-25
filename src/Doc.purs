module Doc
    ( Doc
    , getGraph
    , getClasses
    , getClass
    , getClassNames
    , getUnions
    , getUnionNames
    , getRendererInfo
    , lookupName
    , lookupClassName
    , lookupUnionName
    , string
    , line
    , lines
    , words
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    , typeNameForUnion
    ) where

import IR
import IRGraph
import Prelude

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Foldable (intercalate, sequence_)
import Data.List (List)
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe, fromMaybe)
import Data.Set (Set)
import Data.Set as S
import Data.String as String
import Data.Tuple (Tuple(..), snd)

type DocState = { indent :: Int }
type DocEnv r = { graph :: IRGraph, classNames ::  Map Int String, unionNames :: Map (Set IRType) String, unions :: List (Set IRType), rendererInfo :: r }
newtype Doc r a = Doc (RWS (DocEnv r) String DocState a)

derive newtype instance functorDoc :: Functor (Doc r)
derive newtype instance applyDoc :: Apply (Doc r)
derive newtype instance applicativeDoc :: Applicative (Doc r)
derive newtype instance bindDoc :: Bind (Doc r)
derive newtype instance monadDoc :: Monad (Doc r)
    
runDoc :: forall r a. Doc r a -> (IRClassData -> String) -> (List String -> String) -> (IRType -> Maybe (Set IRType)) -> (String -> String) -> (Set String) -> IRGraph -> r -> String
runDoc (Doc w) nameForClass unionName unionPredicate nextNameToTry forbiddenNames graph rendererInfo =
    let classes = classesInGraph graph
        classNames = transformNames nameForClass nextNameToTry forbiddenNames classes
        unions = L.fromFoldable $ filterTypes unionPredicate graph
        forbiddenForUnions = S.union forbiddenNames $ S.fromFoldable $ M.values classNames
        unionNames = transformNames nameForUnion nextNameToTry forbiddenForUnions $ map (\s -> Tuple s s) unions
    in
        evalRWS w { graph, classNames, unionNames, unions, rendererInfo } { indent: 0 } # snd
    where
        nameForUnion s =
            unionName $ map (typeNameForUnion graph) $ L.sort $ L.fromFoldable s

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

getGraph :: forall r. Doc r IRGraph
getGraph = Doc (asks _.graph)

getClassNames :: forall r. Doc r (Map Int String)
getClassNames = Doc (asks _.classNames)

getUnions :: forall r. Doc r (List (Set IRType))
getUnions = Doc (asks _.unions)

getUnionNames :: forall r. Doc r (Map (Set IRType) String)
getUnionNames = Doc (asks _.unionNames)

getRendererInfo :: forall r. Doc r r
getRendererInfo = Doc (asks _.rendererInfo)

getClasses :: forall r. Doc r (L.List (Tuple Int IRClassData))
getClasses = classesInGraph <$> getGraph

getClass :: forall r. Int -> Doc r IRClassData
getClass i = do
  graph <- getGraph
  pure $ getClassFromGraph graph i

lookupName :: forall a. Ord a => a -> Map a String -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ M.lookup original nameMap

lookupClassName :: forall r. Int -> Doc r String
lookupClassName i = do
    classNames <- getClassNames
    pure $ lookupName i classNames

lookupUnionName :: forall r. Set IRType -> Doc r String
lookupUnionName s = do
    unionNames <- getUnionNames
    pure $ lookupName s unionNames

line :: forall r.  Doc r Unit -> Doc r Unit
line r = do
    indent <- Doc (gets _.indent)
    string $ times "\t" indent
    r
    string "\n"

-- Given a potentially multi-line string, render each line at the current indent level
lines :: forall r. String -> Doc r Unit
lines =
  String.split (String.Pattern "\n")
  >>> map String.trim
  >>> map string
  >>> map line
  >>> sequence_

-- Cannot make this work any other way!
times :: String -> Int -> String
times s n | n < 1 = ""
times s 1 = s
times s n = s <> times s (n - 1)

string :: forall r. String -> Doc r Unit
string = Doc <<< tell

blank :: forall r. Doc r Unit
blank = string "\n"

words :: forall r. Array String -> Doc r Unit
words = string <<< intercalate " "

indent :: forall r a. Doc r a -> Doc r a
indent doc = do
    Doc $ modify (\s -> { indent: s.indent + 1 })
    a <- doc
    Doc $ modify (\s -> { indent: s.indent - 1 })
    pure a