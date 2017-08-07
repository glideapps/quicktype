module Doc
    ( Doc
    , Renderer
    , Transforms
    , getTopLevels
    , getSingleTopLevel
    , getModuleName
    , getForSingleOrMultipleTopLevels
    , getClasses
    , getClass
    , getUnions
    , getUnionNames
    , lookupName
    , lookupClassName
    , lookupUnionName
    , forTopLevel_
    , combineNames
    , NamingResult
    , transformNames
    , simpleNamer
    , string
    , line
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    , runRenderer
    , getTypeNameForUnion
    ) where

import IR
import IRGraph
import Prelude

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Array as A
import Data.Foldable (for_, any)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Set (Set)
import Data.Set as S
import Data.String as String
import Data.String.Util (times) as String
import Data.Tuple (Tuple(..), fst, snd)
import Utils (sortByKey, sortByKeyM)

type Renderer =
    { name :: String
    , extension :: String
    , aceMode :: String
    , doc :: Doc Unit
    , transforms :: Transforms
    }

type NamingResult = { name :: String, forbidAlso :: Array String }

type Transforms =
    { nameForClass :: IRClassData -> Maybe String -> NamingResult
    , unionName :: Maybe (List String -> Maybe String -> NamingResult)
    , unionPredicate :: Maybe (IRType -> Maybe (Set IRType))
    , nextName :: String -> String
    , forbiddenNames :: Array String
    , topLevelNameFromGiven :: String -> String
    , forbiddenFromTopLevelNameGiven :: String -> Array String
    }

type DocState = { indent :: Int }

type DocEnv =
    { graph :: IRGraph
    , classNames :: Map Int String
    , unionNames :: Map (Set IRType) String
    , unions :: List (Set IRType)
    }

newtype Doc a = Doc (RWS DocEnv String DocState a)

derive newtype instance functorDoc :: Functor Doc
derive newtype instance applyDoc :: Apply Doc
derive newtype instance applicativeDoc :: Applicative Doc
derive newtype instance bindDoc :: Bind Doc
derive newtype instance monadDoc :: Monad Doc

runRenderer :: Renderer -> IRGraph -> String
runRenderer { doc, transforms } = runDoc doc transforms

runDoc :: forall a. Doc a -> Transforms -> IRGraph -> String
runDoc (Doc w) t graph@(IRGraph { toplevels }) =
    let classes = classesInGraph graph
        forbiddenFromTopLevels = S.unions $ map (t.forbiddenFromTopLevelNameGiven >>> S.fromFoldable) $ M.keys toplevels
        forbidden = S.union forbiddenFromTopLevels $ S.fromFoldable t.forbiddenNames
        classNames = transformNames t.nameForClass t.nextName forbidden classes
        unions = maybe L.Nil (\up -> L.fromFoldable $ filterTypes up graph) t.unionPredicate
        forbiddenForUnions = S.union forbidden $ S.fromFoldable $ M.values classNames
        nameForUnion un s = un $ map (typeNameForUnion graph) $ L.sort $ L.fromFoldable s
        unionNames = maybe M.empty (\un -> transformNames (nameForUnion un) t.nextName forbiddenForUnions $ map (\s -> Tuple s s) unions) t.unionName
    in
        evalRWS w { graph, classNames, unionNames, unions } { indent: 0 } # snd        

transformNames :: forall a b. Ord a => Ord b => (b -> Maybe String -> NamingResult) -> (String -> String) -> (Set String) -> List (Tuple a b) -> Map a String
transformNames legalize otherize illegalNames names =
    process illegalNames M.empty (sortByKey snd names)
    where
        makeName :: b -> NamingResult -> Set String -> NamingResult
        makeName name result@{ name: tryName, forbidAlso } setSoFar =
            if (S.member tryName setSoFar) || any (\x -> S.member x setSoFar) forbidAlso then
                makeName name (legalize name (Just $ otherize tryName)) setSoFar
            else
                result
        process :: (Set String) -> (Map a String) -> (List (Tuple a b)) -> (Map a String)
        process setSoFar mapSoFar l =
            case l of
            L.Nil -> mapSoFar
            (Tuple identifier inputs) : rest ->
                let { name, forbidAlso } = makeName inputs (legalize inputs Nothing) setSoFar
                    newSoFar = S.union (S.fromFoldable forbidAlso) (S.insert name setSoFar)
                    newMap = M.insert identifier name mapSoFar
                in
                    process newSoFar newMap rest

simpleNamer :: forall a. Ord a => (a -> String) -> a -> Maybe String -> NamingResult
simpleNamer namer _ (Just name) = { name, forbidAlso: [] }
simpleNamer namer x Nothing = { name: namer x, forbidAlso: [] }

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
        in combineNames names
    IRMap t -> typeNameForUnion graph t <> "_map"
    IRUnion _ -> "union"

getTypeNameForUnion :: IRType -> Doc String
getTypeNameForUnion typ = do
  g <- getGraph
  pure $ typeNameForUnion g typ

getGraph :: Doc IRGraph
getGraph = Doc (asks _.graph)

getTopLevels :: Doc (Map String IRType)
getTopLevels = do
    IRGraph { toplevels } <- getGraph
    pure toplevels

getSingleTopLevel :: Doc (Maybe (Tuple String IRType))
getSingleTopLevel = do
    topLevels <- getTopLevels
    case M.toUnfoldable topLevels :: List _ of
        t : L.Nil -> pure $ Just t
        _ -> pure Nothing

getModuleName :: (String -> String) -> Doc String
getModuleName nameStyler = do
    single <- getSingleTopLevel
    pure $ maybe "QuickType" (fst >>> nameStyler) single

getForSingleOrMultipleTopLevels :: forall a. a -> a -> Doc a
getForSingleOrMultipleTopLevels forSingle forMultiple = do
    single <- getSingleTopLevel
    pure $ maybe forMultiple (const forSingle) single

getClassNames :: Doc (Map Int String)
getClassNames = Doc (asks _.classNames)

getUnions :: Doc (List (Set IRType))
getUnions = do
    unsorted <- Doc (asks _.unions)
    sortByKeyM lookupUnionName unsorted

getUnionNames :: Doc (Map (Set IRType) String)
getUnionNames = Doc (asks _.unionNames)

getClasses :: Doc (L.List (Tuple Int IRClassData))
getClasses = do
    unsorted <- classesInGraph <$> getGraph
    sortByKeyM (\t -> lookupClassName (fst t)) unsorted

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

forTopLevel_ :: (String -> IRType -> Doc Unit) -> Doc Unit
forTopLevel_ f = do
    topLevels <- getTopLevels
    for_ (M.toUnfoldable topLevels :: List _) \(Tuple topLevelNameGiven topLevelType) -> do
        f topLevelNameGiven topLevelType

-- Given a potentially multi-line string, render each line at the current indent level
line :: String -> Doc Unit
line s = do
    indent <- Doc (gets _.indent)
    let whitespace = String.times "    " indent
    let lines = String.split (String.Pattern "\n") s
    for_ lines \l -> do
        string whitespace
        string l
        string "\n"  

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

combineNames :: S.Set String -> String
combineNames s = case L.fromFoldable s of
    L.Nil -> "NONAME"
    name : L.Nil -> name
    firstName : rest ->
        let a = String.toCharArray firstName
            { p, s } = L.foldl prefixSuffixFolder { p: a, s: A.reverse a } rest
            prefix = if A.length p > 2 then p else []
            suffix = if A.length s > 2 then A.reverse s else []
            name = String.fromCharArray $ A.concat [prefix, suffix]
        in
            if String.length name > 2 then
                name
            else
                firstName

commonPrefix :: Array Char -> Array Char -> Array Char
commonPrefix a b =
    let l = A.length $ A.takeWhile id $ A.zipWith eq a b
    in A.take l a

prefixSuffixFolder :: { p :: Array Char, s :: Array Char } -> String -> { p :: Array Char, s :: Array Char }
prefixSuffixFolder { p, s } x =
    let a = String.toCharArray x
        newP = commonPrefix p a
        newS = commonPrefix s (A.reverse a)
    in { p: newP, s: newS }
