module Doc
    ( Doc
    , getGraph
    , getClasses
    , getClass
    , string
    , line
    , lines
    , words
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    ) where

import Prelude
import IRGraph
import IR

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Foldable (intercalate, sequence_)
import Data.List as L
import Data.String as String
import Data.Tuple (Tuple, snd)

type DocState = { indent :: Int }
type DocEnv r = { graph :: IRGraph, rendererInfo :: r }
newtype Doc r a = Doc (RWS (DocEnv r) String DocState a)

derive newtype instance functorDoc :: Functor (Doc r)
derive newtype instance applyDoc :: Apply (Doc r)
derive newtype instance applicativeDoc :: Applicative (Doc r)
derive newtype instance bindDoc :: Bind (Doc r)
derive newtype instance monadDoc :: Monad (Doc r)
    
runDoc :: forall r a. Doc r a -> IRGraph -> r -> String
runDoc (Doc w) graph rendererInfo = evalRWS w { graph, rendererInfo } { indent: 0 } # snd

getGraph :: forall r. Doc r IRGraph
getGraph = Doc (asks _.graph)

getRendererInfo :: forall r. Doc r r
getRendererInfo = Doc (asks _.rendererInfo)

getClasses :: forall r. Doc r (L.List (Tuple Int IRClassData))
getClasses = classesInGraph <$> getGraph

getClass :: forall r. Int -> Doc r IRClassData
getClass i = do
  graph <- getGraph
  pure $ getClassFromGraph graph i

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