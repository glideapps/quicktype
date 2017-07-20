module IRGraph where

import Prelude

import Data.Foldable (find, all, any)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromJust, maybe, fromMaybe)
import Data.Sequence as Seq
import Data.Set (Set)
import Data.Set as S
import Data.Tuple (Tuple(..))
import Data.Tuple as T
import Partial.Unsafe (unsafePartial)

data Entry
    = NoType
    | Class IRClassData
    | Redirect Int

newtype IRGraph = IRGraph { classes :: Seq.Seq Entry }

newtype IRClassData = IRClassData { names :: Set String, properties :: Map String IRType }

data IRType
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass Int
    | IRMap IRType
    | IRUnion (Set IRType)

derive instance eqEntry :: Eq Entry
derive instance eqIRType :: Eq IRType
derive instance ordIRType :: Ord IRType
derive instance eqIRClassData :: Eq IRClassData

makeClass :: String -> Map String IRType -> IRClassData
makeClass name properties = IRClassData { names: S.singleton name, properties }

emptyGraph :: IRGraph
emptyGraph = IRGraph { classes: Seq.empty }

followIndex :: IRGraph -> Int -> Tuple Int IRClassData
followIndex graph@(IRGraph { classes }) index =
    unsafePartial $
        case fromJust $ Seq.index index classes of
        Class cd -> Tuple index cd
        Redirect i -> followIndex graph i

getClassFromGraph :: IRGraph -> Int -> IRClassData
getClassFromGraph graph index = T.snd $ followIndex graph index

mapClasses :: forall a. (Int -> IRClassData -> a) -> IRGraph -> List a
mapClasses f (IRGraph { classes }) = L.concat $ L.mapWithIndex mapper (L.fromFoldable classes)
    where
        mapper _ NoType = L.Nil
        mapper _ (Redirect _) = L.Nil
        mapper i (Class cd) = (f i cd) : L.Nil

classesInGraph :: IRGraph -> List IRClassData
classesInGraph  = mapClasses (const id)

lookupOrDefault :: forall k v. Ord k => v -> k -> Map k v -> v
lookupOrDefault default key m = maybe default id $ M.lookup key m

removeElement :: forall a. Ord a => (a -> Boolean) -> S.Set a -> { element :: Maybe a, rest :: S.Set a }
removeElement p s = { element, rest: maybe s (\x -> S.delete x s) element }
    where element = find p s 

isArray :: IRType -> Boolean
isArray (IRArray _) = true
isArray _ = false

isClass :: IRType -> Boolean
isClass (IRClass _) = true
isClass _ = false

isMap :: IRType -> Boolean
isMap (IRMap _) = true
isMap _ = false

-- FIXME: this is horribly inefficient
decomposeTypeSet :: S.Set IRType -> { maybeArray :: Maybe IRType, maybeClass :: Maybe IRType, maybeMap :: Maybe IRType, rest :: S.Set IRType }
decomposeTypeSet s =
    let { element: maybeArray, rest: rest } = removeElement isArray s
        { element: maybeClass, rest: rest } = removeElement isClass rest
        { element: maybeMap, rest: rest } = removeElement isMap rest
    in { maybeArray, maybeClass, maybeMap, rest }

setFromType :: IRType -> S.Set IRType
setFromType IRNothing = S.empty
setFromType x = S.singleton x

nullifyNothing :: IRType -> IRType
nullifyNothing IRNothing = IRNull
nullifyNothing x = x

matchingProperties :: forall v. Eq v => Map String v -> Map String v -> Map String v
matchingProperties ma mb = M.fromFoldable $ L.concatMap getFromB (M.toUnfoldable ma)
    where
        getFromB (Tuple k va) =
            case M.lookup k mb of
            Just vb | va == vb -> Tuple k vb : L.Nil
                    | otherwise -> L.Nil
            Nothing -> L.Nil

propertiesAreSubset :: IRGraph -> Map String IRType -> Map String IRType -> Boolean
propertiesAreSubset graph ma mb = all isInB (M.toUnfoldable ma :: List _)
    where isInB (Tuple n ta) = maybe false (isSubtypeOf graph ta) (M.lookup n mb)

isMaybeSubtypeOfMaybe :: IRGraph -> Maybe IRType -> Maybe IRType -> Boolean
isMaybeSubtypeOfMaybe _ Nothing Nothing = true
isMaybeSubtypeOfMaybe graph (Just a) (Just b) = isSubtypeOf graph a b
isMaybeSubtypeOfMaybe _ _ _ = false

isSubtypeOf :: IRGraph ->  IRType -> IRType -> Boolean
isSubtypeOf _ IRNothing _ = true
isSubtypeOf graph (IRUnion sa) (IRUnion sb) = all (\ta -> any (isSubtypeOf graph ta) sb) sa
isSubtypeOf graph (IRArray a) (IRArray b) = isSubtypeOf graph a b
isSubtypeOf graph (IRMap a) (IRMap b) = isSubtypeOf graph a b
isSubtypeOf graph (IRClass ia) (IRClass ib) =
    let IRClassData { properties: pa } = getClassFromGraph graph ia
        IRClassData { properties: pb } = getClassFromGraph graph ib
    in propertiesAreSubset graph pa pb
isSubtypeOf _ a b = a == b

replaceClassesInType :: (Int -> Maybe IRType) -> IRType -> IRType
replaceClassesInType replacer t =
    case t of
    IRClass i -> fromMaybe t $ replacer i
    IRArray a -> IRArray $ replaceClassesInType replacer a
    IRMap m -> IRMap $ replaceClassesInType replacer m
    IRUnion s -> IRUnion $ S.map (replaceClassesInType replacer) s
    _ -> t

combineNames :: S.Set String -> String
combineNames s = case L.fromFoldable s of
    L.Nil -> "NONAME"
    n : _ -> n
